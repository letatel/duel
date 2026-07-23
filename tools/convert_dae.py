"""One-off .dae -> .glb converter for the original Unity project's piece
models. Run with headless Blender (tested on Blender 4.2 LTS):

    blender --background --python tools/convert_dae.py -- <input.dae> <output.glb>

See README.md's "3D models" section for the full regeneration story,
including the one-time orientation correction frontend/src/scene/models.ts
applies afterward (this script does a plain, uncorrected conversion).
"""
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
input_path, output_path = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.collada_import(filepath=input_path)

bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format="GLB",
    use_selection=False,
    export_yup=True,
)
print(f"[convert] wrote {output_path}")
