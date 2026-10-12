# Brief: a brand-free premium laptop model for a product film

You are modelling the hero device for a product film (GenieTerm, a terminal app). It appears in two
shots: a 3/4 view from the front-left and above, where the lid closes, the room goes dark and it opens
again; and a push-in straight through the screen. It must read as a beautiful, modern, premium
aluminium unibody laptop at 4K. It must be **brand-free**: no Apple logo, no notch, no keyboard
legends, no product names anywhere, and it must not copy any one manufacturer's industrial design
closely.

## Where to work

- Blender 5.0.1 runs headless as a Python module (`pip install bpy==5.0.*`) on a GPU machine,
  in a venv under `~/genie-film-blender/` (it has `bpy` and `numpy`). Work only inside that folder;
  other people's jobs run on that machine. The GPU is an RTX 5090: Cycles with
  OPTIX or CUDA is fine for previews, and keep previews small (e.g. 1600x900, 64 to 128 samples).
- Locally, write everything into this folder (`film/blender/`). Copy files with `scp`.
- Keep the generator as one reproducible script, `film/blender/laptop.py`, that builds the scene from
  nothing and exports. No hand-made .blend state.

## Geometry contract (must match exactly; other code depends on these numbers)

Units: **1 Blender unit = 1 cm**. Export glTF with **+Y up** (the standard glTF exporter conversion).
After conversion, in glTF/three.js space (Y up, +Z toward the viewer/front of the laptop):

- **Base**: footprint 31.2 (x) by 22.0 (z), thickness 1.1 (y), centred at the origin, so it spans
  y from -0.55 to +0.55 and z from -11.0 (back) to +11.0 (front). A slight taper or softer underside
  is welcome as long as the top deck stays at y = +0.55 and the outline stays inside this box.
- **Hinge axis**: the line parallel to X through (y = 0.55, z = -10.8).
- **Lid**: 31.2 by 21.6, thickness 0.55, modelled **closed**, lying on the deck. Its node `Lid` must
  have its **origin exactly on the hinge axis at (0, 0.55, -10.8)** and no rotation, so that setting
  `Lid.rotation.x = -angle` in three.js opens it by `angle` radians (open is 112 degrees).
  Closed, the lid occupies y from 0.55 to 1.10 and z from -10.8 to +10.8.
- **Screen**: a mesh named `Screen`, child of `Lid`: a rectangle 29.6 (x) by 16.65 (z) on the lid's
  inner face, centred at lid-local (0, -0.006, +10.8) relative to the Lid origin, facing down
  (-Y when closed, toward the viewer when open), with UVs 0..1 across it. Give it its own material
  named `ScreenMat` (black, emissive colour black; we drive it at runtime). The black glass bezel
  around it fills the rest of the inner face with a material named `BezelMat`.
- Keep nothing above the deck that would collide with the closed lid: keys must sit in a shallow
  well so their tops are at or below y = 0.55.

## Design and detail (what makes it look expensive)

- A unibody aluminium body: precise, uniform edge rounding (around 0.15 to 0.25 cm), a fine chamfer
  or polished highlight on the deck edge and the lid edge, and closed it should read as one thin
  slab with a crisp, thin seam, not two separate plates.
- Deck: a full keyboard (about 78 keys, realistic proportions, a wide space bar, arrow-key cluster)
  in a slightly recessed well, keys with tiny rounded tops in soft matte black. A large trackpad,
  flush and glassy-matte. Subtle speaker perforation fields either side of the keyboard (use a normal
  or bump texture or instanced micro-holes, whichever is cheaper).
- A hinge barrel or clutch detail at the back, visible when the lid is open.
- Lid back: clean aluminium, no logo.
- Underside: four small rubber feet.
- Materials (Principled BSDF, values that survive glTF export): aluminium `MetalMat` (silver, metallic
  1, roughness about 0.3 to 0.38, anisotropy not required), keys `KeyMat`, trackpad `PadMat`, feet
  `FootMat`, plus the `ScreenMat` and `BezelMat` above. Avoid procedural node setups that glTF can't
  export; small baked normal maps are fine.
- Budget: under 150k triangles and under 8 MB for the .glb. No Draco or meshopt compression.

## Deliverables

1. `film/blender/laptop.py`, the generator.
2. `film/public/models/laptop.glb`, the export.
3. Preview renders in `film/blender/previews/`: open 3/4 view, half-closed, closed, and a close-up of
   the keyboard and hinge, rendered in Cycles with a neutral studio HDRI-like world (a soft area light
   setup is fine) on a dark background.
4. Iterate. Look at your own previews critically, as an industrial designer would, and fix what
   looks cheap: blobby bevels, gaps, z-fighting, plastic-looking metal, wrong proportions. Do at least
   three critique-and-fix passes before you stop.
5. Finish with a short `film/blender/NOTES.md`: node names, the measured hinge and screen positions in
   the exported file (verify by re-importing the .glb in bpy and printing them), the triangle count
   and the file size.
