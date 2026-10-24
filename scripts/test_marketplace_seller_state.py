import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


class NativeSellerState(unittest.TestCase):
    def run_node(self, script):
        subprocess.run(['node', '--input-type=module', '-e',
            "import assert from 'node:assert/strict'; import {requireFixture,selectSeller,rememberBitkitSeller} from './marketplace/driver/seller-state.mjs';\n" + script],
            cwd=ROOT, check=True, capture_output=True, text=True)

    def test_fresh_native_seller_needs_no_headless_identity_or_spending_keys(self):
        self.run_node("""
        const approved={pubky:'native',kind:'bitkit',client_id:'locks.app',capabilities:'/pub/app.locks/:rw'};
        const state=rememberBitkitSeller({},approved,true,'first');
        assert.equal(requireFixture(state),state);
        assert.equal(requireFixture(state,true),state);
        assert.equal(selectSeller(state,'bitkit').pubky,'native');
        assert.equal(selectSeller(state,'native').setup_completed_at,'first');
        assert.equal(state.seller,undefined);
        assert.throws(()=>selectSeller(state,'headless'),/no headless seller/);
        assert.throws(()=>selectSeller(state,'other'),/--seller must/);
        assert.throws(()=>requireFixture({}),/no seller yet/);
        """)

    def test_same_identity_preserves_setup_but_replacement_cannot_inherit_it(self):
        self.run_node("""
        const first=rememberBitkitSeller({}, {pubky:'a'},true,'first');
        assert.equal(rememberBitkitSeller(first,{pubky:'a'},true,'again').bitkit_seller.setup_completed_at,'first');
        const replaced=rememberBitkitSeller(first,{pubky:'b'},false,'new');
        assert.equal(replaced.bitkit_seller.setup_completed_at,undefined);
        assert.equal(replaced.bitkit_seller.marketplace_grant_at,'new');
        assert.equal(first.bitkit_seller.pubky,'a');
        """)

    def test_headless_flow_remains_explicit_and_native_grant_has_no_seed_precheck(self):
        self.run_node("""
        const headless={seller:{pubky:'headless',kind:'headless'}};
        assert.equal(requireFixture(headless),headless);
        assert.equal(selectSeller(headless,'headless'),headless.seller);
        assert.throws(()=>requireFixture(headless,true),/no Bitkit seller/);
        const withNative=rememberBitkitSeller(headless,{pubky:'native'},true,'now');
        assert.equal(withNative.seller,headless.seller);
        """)
        source=(ROOT/'marketplace/driver/driver.mjs').read_text()
        start=source.split('async function sellerAuth(args) {',1)[1].split('\n}',1)[0]
        self.assertNotIn('readFixture()',start)
        adopt=source.split('async function adoptBitkitSeller(session, kind) {',1)[1].split('\n}',1)[0]
        self.assertIn('await readJson(FIXTURE_FILE, {})',adopt)
        self.assertIn('rememberBitkitSeller',adopt)


if __name__ == '__main__':unittest.main()
