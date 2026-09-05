import copy
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import rustchain_transfer_sign_demo as mod


class TransferSigningTests(unittest.TestCase):
    def setUp(self):
        self.payload, self.message = mod.build_demo_payload(
            "RTC" + "22" * 20, "1.25", "offline-demo", 1770000000
        )

    def test_valid_payload_verifies(self):
        self.assertTrue(mod.verify_payload(self.payload))

    def test_address_matches_public_key_hash(self):
        pub = bytes.fromhex(self.payload["public_key"])
        self.assertEqual(self.payload["from_address"], mod.rtc_address(pub))

    def test_amount_tamper_breaks_signature(self):
        tampered = copy.deepcopy(self.payload)
        tampered["amount_rtc"] = 9.0
        self.assertFalse(mod.verify_payload(tampered))

    def test_recipient_tamper_breaks_signature(self):
        tampered = copy.deepcopy(self.payload)
        tampered["to_address"] = "RTC" + "33" * 20
        self.assertFalse(mod.verify_payload(tampered))

    def test_canonical_json_has_sorted_compact_keys(self):
        text = self.message.decode("utf-8")
        self.assertEqual(text, '{"amount":1.25,"from":"%s","memo":"offline-demo","nonce":"1770000000","to":"%s"}' % (self.payload["from_address"], self.payload["to_address"]))


if __name__ == '__main__':
    unittest.main(verbosity=2)
