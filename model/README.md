# Body model

`body.bin` and `body.json` (format v4) are converted from **Universal Base Characters** by Quaternius,
Superhero Male, released under CC0 (public domain). `body_color.jpg` and `body_normal.jpg` are the
pack's textures. The converter is `tools/convert_rigged.py`.

Each vertex is assigned to the muscle region of its dominant bone. Arms are split into biceps, triceps
and shoulders, and legs into quads and hamstrings. Hair and eyes are left out. The figure is scaled to
1.76 m, with feet on the floor and the front facing +z.

In the colour cropped texture, the bandeau-style top baked into the chest area was painted over with the
surrounding skin (OpenCV inpainting). The black shorts are kept.
