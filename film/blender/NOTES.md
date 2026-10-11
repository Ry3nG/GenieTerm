# Laptop asset

Final export: `../public/models/laptop.glb` — **90,978 triangles; 2,617,376 bytes
(2.50 MiB)**. No Draco, meshopt, external textures, logos, notch, or key legends.
78 recessed keys, 564 blind speaker perforations, twin exposed clutches, two USB-C
recesses, flush trackpad, and four rubber feet. MetalMat: metallic 1, roughness 0.31.

## Reproduce

Requires Blender 5.0.1's `bpy`; no source assets or saved Blender scene required.
Running `python blender/laptop.py` writes the final model and previews to their
project locations. On the GPU server, keep all output under the assigned folder:

```sh
cd ~/genie-film-blender
.venv/bin/python laptop.py --out-dir output --samples 128 --width 1600
```

The generator exports **closed**, clears the scene, re-imports that GLB, asserts
the geometry contract, prints measurements, writes `measurements.json`, and
renders the imported geometry. Studio lights, floor, and camera are not exported.
Final PNGs are `previews/open.png` (112°), `half-closed.png` (48°), `closed.png`
(0°), and `keyboard-hinge.png`. All are Cycles/OptiX, 1600×900, 128 samples.

## Verified round-trip measurements

Coordinates below are **glTF +Y up**, in centimetre-sized units. Values are rounded
to six decimals; generator assertions allow 0.00001 unit for float32 precision.

| Measurement | Exported/re-imported value |
| --- | --- |
| `Lid` hinge origin, world | `(0, 0.55, -10.8)` |
| `Lid` rotation, quaternion xyzw | `(0, 0, 0, 1)` |
| `Screen` centre, relative to `Lid` | `(0, -0.006, 10.8)` |
| `Screen` centre, closed world | `(0, 0.544, 0)` |
| `Screen` normal, closed | `(0, -1, 0)` |
| `Screen` dimensions / UV range | `29.6 × 16.65` / `(0,0)`–`(1,1)` |
| `Screen` centre, 112° open world | `(0, 10.565834, -14.840189)` |
| Base bounds, minimum → maximum | `(-15.6,-0.55,-11)` → `(15.6,0.55,11)` |
| Lid shell bounds, closed | `(-15.6,0.55,-10.8)` → `(15.6,1.1,10.8)` |
| Key tops | `y = 0.51`, below the `0.55` deck |

Root is `Laptop`. Animate `Lid.rotation.x = -angle` in three.js.
`Screen`, `Bezel`, `DisplaySeal`, and `LidShell` are direct children of `Lid`.
Other principal nodes: `Base`, `Keyboard_78Keys`, `KeyboardWell`, `Trackpad`,
`TrackpadChamfer`, `TrackpadGasket`, `SpeakerPerforations`, plus `HingeClutch_*`,
`HingeCollar_*`, `HingeMount_*`, `HingePocket_*`, `Foot_*`, and `USB_C_*`.
The full node list is in `measurements.json`.

Materials: `MetalMat`, `KeyMat`, `PadMat`, `FootMat`, `ScreenMat`, `BezelMat`,
`EdgeMat`, `RecessMat`, `PerforationMat`. ScreenMat base and emission are black.
All use portable Principled PBR; `KHR_materials_specular` preserves the restrained
key/screen reflections. The screen's UV top corresponds to the lid's free edge.

## Preview critique and fixes

Every PNG in each review set was opened and visually inspected, including the
four final PNGs. Earlier renders remain in `previews/pass-0` through `pass-3`.

- Diagnostic → pass 1: corrected quaternion/Euler preview rotation, tightened key
  bevels, reduced oversized speaker dots, and added a front edge strip light.
- Pass 1 → 2: fixed cropped hero framing; cut rear pockets to expose the hidden
  hinges; reduced key gloss; differentiated the trackpad; added recessed ports.
- Pass 2 → 3: darkened the keyboard well, reduced screen specularity, added hero
  breathing room, softened the studio floor, and replaced dots with real bores.
- Pass 3 → final: removed sparkling bore-wall highlights with dark matte interiors,
  toned down the pale pad, and moved the fill light to clear the open screen.
  Final inspection confirmed clean seams, readable clutches, subtle perforations,
  and no visible z-fighting. The angled glass retains a natural softbox reflection
  in the half-closed shot.
