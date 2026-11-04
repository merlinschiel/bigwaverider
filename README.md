# Nazaré: Canyon Surf

A small browser surf game about why Nazaré (Portugal) gets the biggest surfed waves on
Earth. Made for a coastal dynamics presentation. It is a plain static web page in `web/`
with no build step, published with GitHub Pages.

## How to play

1. **Pick a swell** on the map: drag the swell arrow, set period and size.
2. **Lock it in** to see how the canyon bends your swell and how big the waves get.
3. **Surf it**: you are towed into three waves from that swell.

| | Keyboard | Touch |
| --- | --- | --- |
| Steer up / down the wave | Up / Down (or W / S) | Up / down buttons |
| Pump for speed / slow down | Right / Left (or D / A) | Right / left buttons |
| Let go of the tow rope | Space (or wait) | Tap |
| Spin in the air | Left / Right | Left / right buttons |
| Pause | Esc or P | Pause button |

## Leaderboard

Scores go to a Google Sheet. Add `?board` to the game link for a live projector view
with a QR code to join. Setup: [leaderboard/README.md](leaderboard/README.md).

## Run it locally

```bash
python3 tools/serve.py
```

Then open http://localhost:8000.

## How it works

- Swell rays are traced over the real sea floor (refraction from the dispersion relation
  w^2 = g k tanh(k h)), and wave heights along the coast follow from energy flux between
  rays (shoaling and refraction), with depth-limited breaking at H = 0.78 h.
- The "canyon filled in" comparison runs the same model with the canyon filled up to the
  depth of the surrounding shelf.
- Swell of 14 s and longer breaks as plunging waves (barrels), shorter swell spills.
- It is a teaching model: linear wave theory, one period at a time, no diffraction,
  currents or wind. The physics is in `web/js/physics.js`.

## Data and sources

Bathymetry: EMODnet Bathymetry Consortium, EMODnet Digital Terrain Model (CC BY 4.0),
packed by `tools/build_bathymetry.py`.

- Hope, G. et al. (2026). *Focusing of Swell at the Nazaré Submarine Canyon.* EGUsphere
  preprint. https://doi.org/10.5194/egusphere-2026-2778
- Magne, R. et al. (2007). *Evolution of surface gravity waves over a submarine canyon.*
  Journal of Geophysical Research, 112, C01002. https://doi.org/10.1029/2005JC003035
- Bosboom, J. and Stive, M. J. F. (2023). *Coastal Dynamics.* TU Delft Open Textbook.
  https://doi.org/10.5074/T.2021.001
