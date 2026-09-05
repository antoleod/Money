import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import rustchain_balance_check as mod


class BalanceContractTests(unittest.TestCase):
    def test_documented_balance_is_consistent(self):
        bal = mod.parse_balance({
            'miner_id': 'exampleRTC',
            'amount_i64': 118357193,
            'amount_rtc': 118.357193,
        })
        self.assertTrue(bal.units_match)
        self.assertEqual(bal.expected_i64, 118357193)

    def test_mismatch_is_detected(self):
        bal = mod.parse_balance({
            'miner_id': 'exampleRTC',
            'amount_i64': 118357192,
            'amount_rtc': 118.357193,
        })
        self.assertFalse(bal.units_match)

    def test_negative_balance_is_rejected(self):
        with self.assertRaises(mod.BalanceError):
            mod.parse_balance({
                'miner_id': 'exampleRTC',
                'amount_i64': -1,
                'amount_rtc': -0.000001,
            })

    def test_more_than_six_decimals_is_rejected_on_conversion(self):
        bal = mod.parse_balance({
            'miner_id': 'exampleRTC',
            'amount_i64': 1,
            'amount_rtc': '0.0000001',
        })
        with self.assertRaises(mod.BalanceError):
            _ = bal.expected_i64


if __name__ == '__main__':
    unittest.main(verbosity=2)
