import unittest

import optuna


def proposal_sequence():
    sampler = optuna.samplers.GPSampler(seed=7, deterministic_objective=True, n_startup_trials=3)
    study = optuna.create_study(direction="minimize", sampler=sampler)

    def objective(trial):
        x = trial.suggest_float("x", -1.0, 1.0)
        y = trial.suggest_float("y", 0.001, 0.1, log=True)
        trial.set_constraint("box", max(abs(x) - 0.8, y - 0.08))
        return (x - 0.15) ** 2 + (y - 0.02) ** 2

    study.optimize(objective, n_trials=6)
    return [tuple(trial.params[name] for name in ("x", "y")) for trial in study.trials]


class GPSamplerDeterminismTests(unittest.TestCase):
    def test_identical_fresh_studies_propose_identical_sequence(self):
        self.assertEqual(proposal_sequence(), proposal_sequence())


if __name__ == "__main__":
    unittest.main()
