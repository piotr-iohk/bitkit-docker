import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class SavedFixturePinsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        (self.root / '.marketplace').mkdir()
        (self.root / 'marketplace/patches').mkdir(parents=True)
        (self.root / 'marketplace/patches/paykit-server-example.patch').write_text('example')
        shutil.copyfile(ROOT / 'pubky-marketplace', self.root / 'pubky-marketplace')
        shutil.copyfile(ROOT / 'scripts/paykit-lock.py', self.root / 'scripts/paykit-lock.py')
        self.pins = {'serverRevision': 'a'*40, 'paykitRevision': 'b'*40, 'paykitTag': 'v0.1.0', 'locksRevision': 'c'*40, 'locksTag': 'v0.1.0'}

    def command(self, overrides=None):
        (self.root / '.marketplace/paykit-pins.json').write_text(json.dumps(self.pins))
        env = {'PATH': os.environ['PATH'], 'HOME': str(self.root), **(overrides or {})}
        return subprocess.run(['bash', str(self.root / 'pubky-marketplace'), 'pins'], cwd=self.root, env=env, capture_output=True, text=True)

    def test_later_commands_retain_verified_stable_and_prerelease_pins(self):
        for tag, image_tag in [('v0.1.0', '0.1.0-shared'), ('v0.1.0-rc65', 'rc65-shared')]:
            with self.subTest(tag=tag):
                self.pins['paykitTag'] = tag
                result = self.command()
                self.assertEqual(result.returncode, 0, result.stderr)
                observed = json.loads(result.stdout)
                self.assertEqual(observed['serverRevision'], self.pins['serverRevision'])
                self.assertEqual(observed['paykitRevision'], self.pins['paykitRevision'])
                self.assertEqual(observed['fixtureTag'], image_tag)

    def test_explicit_operator_overrides_win_without_using_a_stale_image_tag(self):
        result = self.command({'PAYKIT_RS_REV': 'd'*40, 'PAYKIT_RS_TAG': 'v0.2.0'})
        self.assertEqual(result.returncode, 0, result.stderr)
        observed = json.loads(result.stdout)
        self.assertEqual(observed['paykitRevision'], 'd'*40)
        self.assertEqual(observed['fixtureTag'], '0.2.0-shared')

    def test_malformed_saved_pins_stop_before_any_fixture_command(self):
        for bad in ['v0.1.0; touch should-not-exist', 123, '$(touch should-not-exist)']:
            with self.subTest(bad=bad):
                self.pins['paykitTag'] = bad
                result = self.command()
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.root / 'should-not-exist').exists())
                self.assertNotIn('serverRevision', result.stdout)


if __name__ == '__main__':
    unittest.main()
