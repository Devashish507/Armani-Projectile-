import sys
from pathlib import Path

import numpy as np
import pytest

# Ensure the backend root is on the path when running standalone
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.orbit.transfer import compute_hohmann_transfer, generate_transfer_trajectory


def test_hohmann_transfer_leo_to_geo():
    """Test calculation parameters from a standard LEO to GEO transfer."""
    r1 = 7_000_000.0  # LEO ~620 km
    r2 = 42_164_000.0  # GEO
    
    params = compute_hohmann_transfer(r1, r2)
    
    assert "delta_v1" in params
    assert "delta_v2" in params
    assert "total_delta_v" in params
    assert "transfer_time" in params
    
    # Physics bounds check
    assert 18000 < params["transfer_time"] < 20000  # LEO to GEO takes ~5.3 hours
    assert params["delta_v1"] > 0
    assert params["delta_v2"] > 0
    assert abs(params["total_delta_v"] - (params["delta_v1"] + params["delta_v2"])) < 1e-6


def test_hohmann_transfer_invalid_inputs():
    """Test guard checks for invalid transfer inputs."""
    with pytest.raises(ValueError, match="must be strictly positive"):
        compute_hohmann_transfer(-1000.0, 7_000_000.0)
        
    with pytest.raises(ValueError, match="Cannot transition between identical orbits"):
        compute_hohmann_transfer(7_000_000.0, 7_000_000.0)


def test_generate_transfer_trajectory():
    """Test generating the actual 3-phase trajectory logic."""
    r1 = 7_000_000.0
    r2 = 42_164_000.0
    time, pos, vel = generate_transfer_trajectory(r1, r2)
    
    # Trajectory should have 3 phases * ~200 points
    assert len(time) > 300
    assert pos.shape[0] > 300
    assert vel.shape[0] > 300
    
    # Initial point should be at exact r1 magnitude
    assert np.isclose(np.linalg.norm(pos[0]), r1)
    
    # Last point should be at exact r2 magnitude
    assert np.isclose(np.linalg.norm(pos[-1]), r2)
