# Body model

`body.bin`, `body.json` (format v4) and `seams.bin` are converted from **Universal Base Characters** by
Quaternius, Superhero Male, released under CC0 (public domain). The converter is `tools/convert_rigged.py`.

Each vertex is assigned to the muscle region of its dominant bone, then the region borders are smoothed.
Arms are split into biceps, triceps and shoulders, and legs into quads and hamstrings. Hair and eyes are left
out. `seams.bin` holds the dark lines where two muscle groups meet. The figure is scaled to 1.76 m, with feet
on the floor and the front facing +z.
