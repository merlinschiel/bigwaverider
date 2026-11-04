"""Download real bathymetry around Nazare and pack it for the web game.

Source: EMODnet Digital Terrain Model (mean depth, 1/16 arc minute, about 115 m), served
by the EMODnet Bathymetry WCS. Licence CC BY 4.0, credit "EMODnet Bathymetry Consortium".

The grid is converted to the game's local frame (metres, x east, y north) with the
Nazare lighthouse at (-390, -950), resampled to 80 m, lightly smoothed and written as

  web/data/bathymetry.bin   little-endian int16, depth in decimetres (negative on land),
                            row-major from the south-west corner
  web/data/bathymetry.json  grid origin, spacing, size, the mainland shoreline per row
                            and the data credit

Run:  uv run --no-project --with numpy --with scipy --with tifffile python tools/build_bathymetry.py
"""

import io
import json
import pathlib
import urllib.request

import numpy as np
import tifffile
from scipy import ndimage
from scipy.interpolate import RegularGridInterpolator

LIGHTHOUSE = (39.6047, -9.0858)      # Farol da Nazare, lat / lon
LIGHTHOUSE_XY = (-390.0, -950.0)     # its position in the game's frame
X0, X1, Y0, Y1, DX = -22000, 5000, -17000, 17000, 80
M_PER_DEG_LAT = 110574.0
M_PER_DEG_LON = 111320.0 * np.cos(np.radians(LIGHTHOUSE[0]))
STEP = 1 / 960                        # EMODnet cell size in degrees

OUT = pathlib.Path(__file__).resolve().parent.parent / "web" / "data"
URL = ("https://ows.emodnet-bathymetry.eu/wcs?service=WCS&version=2.0.1&request=GetCoverage"
       "&coverageId=emodnet__mean&subset=Lat({:.4f},{:.4f})&subset=Long({:.4f},{:.4f})&format=image/tiff")


def to_lonlat(x, y):
    lon = LIGHTHOUSE[1] + (x - LIGHTHOUSE_XY[0]) / M_PER_DEG_LON
    lat = LIGHTHOUSE[0] + (y - LIGHTHOUSE_XY[1]) / M_PER_DEG_LAT
    return lon, lat


def main():
    lon0, lat0 = to_lonlat(X0 - 500, Y0 - 500)
    lon1, lat1 = to_lonlat(X1 + 500, Y1 + 500)
    url = URL.format(lat0, lat1, lon0, lon1)
    print("downloading", url)
    with urllib.request.urlopen(url, timeout=120) as r:
        tif = tifffile.TiffFile(io.BytesIO(r.read()))
    page = tif.pages[0]
    z = page.asarray().astype(float)                  # elevation, negative below sea level
    tr = page.tags["ModelTransformationTag"].value
    lon_west, lat_north = tr[3], tr[7]
    ny, nx = z.shape
    lons = lon_west + (np.arange(nx) + 0.5) * STEP
    lats = lat_north - (np.arange(ny) + 0.5) * STEP
    if np.isnan(z).any():
        print("filling", int(np.isnan(z).sum()), "missing cells")
        idx = ndimage.distance_transform_edt(np.isnan(z), return_distances=False, return_indices=True)
        z = z[tuple(idx)]

    # resample onto the game grid
    xs = np.arange(X0, X1 + DX / 2, DX)
    ys = np.arange(Y0, Y1 + DX / 2, DX)
    gx, gy = np.meshgrid(xs, ys)
    glon, glat = to_lonlat(gx, gy)
    interp = RegularGridInterpolator((lats[::-1], lons), z[::-1], bounds_error=False, fill_value=None)
    depth = -interp(np.stack([glat, glon], axis=-1))
    depth = ndimage.gaussian_filter(depth, 0.7)

    # mainland only: drop breakwaters and rocks so the shoreline is one clean line
    land = depth <= 0
    labels, n = ndimage.label(land)
    if n > 1:
        sizes = ndimage.sum(land, labels, range(1, n + 1))
        main_land = labels == (1 + int(np.argmax(sizes)))
        islands = land & ~main_land
        depth[islands] = 0.5
        land = main_land

    # shoreline: first mainland cell seen from the west, refined to the zero crossing
    shore = []
    for j in range(len(ys)):
        hit = np.where(land[j])[0]
        if len(hit) == 0:
            shore.append(float(xs[-1]))
            continue
        i = int(hit[0])
        if i == 0:
            shore.append(float(xs[0]))
            continue
        h0, h1 = depth[j, i - 1], depth[j, i]
        f = h0 / max(h0 - h1, 1e-6)
        shore.append(float(xs[i - 1] + f * DX))
    shore = ndimage.gaussian_filter1d(np.array(shore), 1.0)

    OUT.mkdir(parents=True, exist_ok=True)
    dm = np.clip(np.round(depth * 10), -32000, 32000).astype("<i2")
    (OUT / "bathymetry.bin").write_bytes(dm.tobytes())
    meta = {
        "x0": X0, "y0": Y0, "dx": DX, "nx": len(xs), "ny": len(ys),
        "units": "int16 decimetres of water depth, negative on land, rows south to north",
        "shoreline": [round(v, 1) for v in shore.tolist()],
        "credit": "Bathymetry: EMODnet Bathymetry Consortium, EMODnet Digital Terrain Model (CC BY 4.0)",
        "source": url,
    }
    (OUT / "bathymetry.json").write_text(json.dumps(meta))
    print(f"wrote {len(xs)} x {len(ys)} grid, {dm.nbytes / 1024:.0f} KB,",
          f"depth {depth.min():.0f} to {depth.max():.0f} m")


if __name__ == "__main__":
    main()
