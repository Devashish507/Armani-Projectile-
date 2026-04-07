import sys
sys.path.append('.')
from services.orbit.transfer import compute_hohmann_transfer, generate_transfer_trajectory

# Orbit raising LEO to GEO
r_leo = 7000000.0  # 7000 km
r_geo = 42164000.0 # 42164 km

print("Computing transfer params...")
params = compute_hohmann_transfer(r_leo, r_geo)
print(params)

print("Computing trajectory...")
time, pos, vel = generate_transfer_trajectory(r_leo, r_geo)
print(f"Trajectory computed. Time steps: {len(time)}")
print(f"First pos: {pos[0]}")
print(f"Last pos: {pos[-1]}")
