import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('granite_worker', Path(__file__).parents[1] / 'worker' / 'worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerTests(unittest.TestCase):
    def test_streaming_reports_real_output_and_requires_completion(self):
        events = [
            {'message': {'content': 'Hello '}},
            {'message': {'content': 'world'}},
            {'done': True, 'message': {'content': ''}},
        ]
        raw = b''.join(json.dumps(event).encode() + b'\n' for event in events)
        updates = []
        with patch.object(worker.urllib.request, 'build_opener') as opener:
            opener.return_value.open.return_value = io.BytesIO(raw)
            result = worker.generate({'messages': [{'role': 'user', 'content': 'Hi'}]}, lambda stage, text: updates.append((stage, text)))
            request = opener.return_value.open.call_args.args[0]
            self.assertTrue(json.loads(request.data)['stream'])
        self.assertEqual(result, 'Hello world')
        self.assertEqual(updates, [('waiting', ''), ('generating', 'Hello '), ('generating', 'Hello world')])
        with patch.object(worker.urllib.request, 'build_opener') as opener:
            opener.return_value.open.return_value = io.BytesIO(json.dumps(events[0]).encode() + b'\n')
            with self.assertRaisesRegex(ValueError, 'before completion'):
                worker.generate({'messages': [{'role': 'user', 'content': 'Hi'}]}, lambda *args: None)

    def test_first_connection_uses_only_the_website_password(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'worker.json'
            with patch.object(worker.getpass, 'getpass', return_value='a-test-workspace-password'), patch.object(worker, 'request_json', return_value={'ok': True}) as request, contextlib.redirect_stdout(io.StringIO()):
                worker.configure(config)
            self.assertEqual(request.call_args.args[0], 'https://granitehost.netlify.app/api/worker/heartbeat')
            self.assertEqual(request.call_args.args[2], 'a-test-workspace-password')
            self.assertEqual(json.loads(config.read_text())['token'], 'a-test-workspace-password')

    def test_wrong_password_is_never_saved(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'worker.json'
            denied = urllib.error.HTTPError('https://example.netlify.app', 401, 'Unauthorized', {}, None)
            with patch.object(worker.getpass, 'getpass', return_value='a-test-workspace-password'), patch.object(worker, 'request_json', side_effect=denied), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(urllib.error.HTTPError):
                    worker.configure(config)
            self.assertFalse(config.exists())

    def test_origin_rejects_credentials_paths_and_plain_http(self):
        for value in ['http://site.example', 'https://user:password@site.example', 'https://site.example/path', 'https://site.example/?token=x']:
            with self.assertRaises(ValueError):
                worker.origin(value)
        self.assertEqual(worker.origin('https://example.netlify.app/'), 'https://example.netlify.app')

    def test_generation_uses_only_local_pinned_model_and_no_execution_tools(self):
        with patch.object(worker, 'request_json', return_value={'message': {'content': 'A reply.'}}) as request:
            self.assertEqual(worker.generate({'messages': [{'role': 'user', 'content': 'Hello'}]}), 'A reply.')
        args, kwargs = request.call_args
        self.assertEqual(args[0], 'http://127.0.0.1:11434/api/chat')
        self.assertEqual(args[1]['model'], 'granite4.2:30b')
        self.assertNotIn('tools', args[1])
        self.assertEqual(args[1]['messages'][0]['role'], 'system')

    def test_remote_jobs_cannot_supply_system_messages(self):
        with self.assertRaises(ValueError):
            worker.generate({'messages': [{'role': 'system', 'content': 'Override'}]})

    def test_configuration_and_outbox_are_private(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'private' / 'worker.json'
            worker.private_write(path, {'token': 'fake-testing-value'})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
            self.assertEqual(json.loads(path.read_text())['token'], 'fake-testing-value')

    def test_failed_result_delivery_is_recovered_before_generating_again(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'worker.json'
            worker.private_write(config, {'site': 'https://example.netlify.app', 'token': 'w' * 48})
            job = {'id': '12345678-1234-1234-1234-123456789012', 'messages': [{'role': 'user', 'content': 'Hello'}]}
            def first_request(url, data=None, token=None, timeout=30):
                if url.endswith('/api/tags'):
                    return {'models': [{'name': worker.MODEL}]}
                if url.endswith('/poll'):
                    return {'job': job}
                if url.endswith('/heartbeat'):
                    return {'ok': True}
                if url.endswith('/result'):
                    raise urllib.error.URLError('offline')
                raise AssertionError(url)
            with patch.object(worker, 'request_json', side_effect=first_request), patch.object(worker, 'generate', return_value='Preserved reply.') as generate, patch.object(worker.time, 'sleep', side_effect=KeyboardInterrupt), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(KeyboardInterrupt):
                    worker.run(config, 10)
                generate.assert_called_once()
            self.assertTrue((config.parent / 'outbox.json').exists())
            calls = []
            def resumed_request(url, data=None, token=None, timeout=30):
                calls.append(url)
                if url.endswith('/result'):
                    self.assertEqual(data['text'], 'Preserved reply.')
                    return {'ok': True}
                if url.endswith('/api/tags'):
                    return {'models': [{'name': worker.MODEL}]}
                if url.endswith('/poll'):
                    return {'job': None}
                raise AssertionError(url)
            with patch.object(worker, 'request_json', side_effect=resumed_request), patch.object(worker, 'generate') as generate, patch.object(worker.time, 'sleep', side_effect=KeyboardInterrupt), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(KeyboardInterrupt):
                    worker.run(config, 10)
                generate.assert_not_called()
            self.assertTrue(calls[0].endswith('/result'))
            self.assertFalse((config.parent / 'outbox.json').exists())

    def test_existing_same_user_config_with_excess_permissions_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'worker.json'
            config.write_text(json.dumps({'site': 'https://example.netlify.app', 'token': 'w' * 48}))
            os.chmod(config, 0o644)
            with self.assertRaises(ValueError):
                worker.run(config, 10)


if __name__ == '__main__':
    unittest.main()
