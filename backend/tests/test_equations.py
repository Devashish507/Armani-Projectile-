import logging
import sys
from pathlib import Path

import numpy as np
import pytest

# Ensure the backend root is on the path when running standalone
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.constants import R_EARTH
from services.orbit.equations import state_derivative, two_body_acceleration


def test_two_body_acceleration_valid():
    """Test valid acceleration calculation."""
    r = np.array([R_EARTH + 400000.0, 0.0, 0.0])  # Typical LEO
    acc = two_body_acceleration(r)
    
    # The magnitude should be around 8.68 m/s^2, pointing directly back to Earth (-x)
    assert acc[0] < 0
    assert abs(acc[1]) < 1e-10
    assert abs(acc[2]) < 1e-10
    
    mag = np.linalg.norm(acc)
    assert 8.0 < mag < 9.82


def test_two_body_acceleration_zero_magnitude():
    """Test acceleration at zero magnitude, should raise ValueError."""
    r = np.array([0.0, 0.0, 0.0])
    with pytest.raises(ValueError, match="zero magnitude"):
        two_body_acceleration(r)


def test_two_body_acceleration_nan():
    """Test acceleration with NaN input, should raise ValueError."""
    r = np.array([np.nan, 0.0, 0.0])
    with pytest.raises(ValueError, match="non-finite"):
        two_body_acceleration(r)


def test_two_body_acceleration_sub_surface(caplog):
    """Test acceleration below Earth's surface triggers a warning."""
    r = np.array([R_EARTH - 1000.0, 0.0, 0.0])
    with caplog.at_level(logging.WARNING):
        two_body_acceleration(r)
        assert "below Earth's radius" in caplog.text


def test_state_derivative():
    """Test that the state derivative integrates velocity as position derivative."""
    state = np.array([7_000_000.0, 0.0, 0.0, 0.0, 7500.0, 0.0])
    deriv = state_derivative(0.0, state)
    
    # Derivative should be [v_x, v_y, v_z, a_x, a_y, a_z]
    assert len(deriv) == 6
    assert np.allclose(deriv[:3], state[3:])  # Velocity is derivative of position
