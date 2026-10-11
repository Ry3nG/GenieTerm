#!/usr/bin/env python3
"""Reproducible brand-free laptop. Run with Blender 5's bpy Python module.

python laptop.py --out-dir /path/to/output
Exports a closed, centimetre-space GLB, validates its round trip, and renders
four studio views. --render-only selects comma-separated view names.
Without --out-dir, writes ../public/models/laptop.glb and ./previews/.
"""
from __future__ import annotations

import argparse
import json
import math
import struct
from pathlib import Path

import bpy
from mathutils import Vector


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out-dir', type=Path)
    parser.add_argument('--pass-number', type=int, default=4, choices=(0, 1, 2, 3, 4))
    parser.add_argument('--samples', type=int, default=96)
    parser.add_argument('--width', type=int, default=1600)
    parser.add_argument('--render-only', default='open,half-closed,closed,keyboard-hinge')
    parser.add_argument('--skip-render', action='store_true')
    return parser.parse_args()


def material(name, color, metal=0.0, roughness=0.4):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metal
    shader.inputs['Roughness'].default_value = roughness
    return mat


def outline(width, depth, radius, steps=10):
    points = []
    for cx, cy, start in ((width / 2 - radius, depth / 2 - radius, 0),
                          (-width / 2 + radius, depth / 2 - radius, 90),
                          (-width / 2 + radius, -depth / 2 + radius, 180),
                          (width / 2 - radius, -depth / 2 + radius, 270)):
        for i in range(steps + 1):
            angle = math.radians(start + i * 90 / steps)
            points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return points


def profile_solid(name, rings, mats, parent=None, location=(0, 0, 0), strip_mats=None, steps=10):
    vertices = []
    for z, width, depth, radius in rings:
        vertices.extend((x, y, z) for x, y in outline(width, depth, radius, steps))
    n = len(vertices) // len(rings)
    faces = [tuple(reversed(range(n)))]
    indices = [0]
    for j in range(len(rings) - 1):
        for i in range(n):
            faces.append((j * n + i, j * n + (i + 1) % n,
                          (j + 1) * n + (i + 1) % n, (j + 1) * n + i))
            indices.append(strip_mats[j] if strip_mats else 0)
    faces.append(tuple((len(rings) - 1) * n + i for i in range(n)))
    indices.append(0)
    mesh = bpy.data.meshes.new(name + 'Mesh')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.parent = parent
    for mat in mats:
        mesh.materials.append(mat)
    for poly, index in zip(mesh.polygons, indices):
        poly.material_index = index
        poly.use_smooth = len(poly.vertices) == 4
    return obj


def box(name, width, depth, height, location, mat, radius=0.2, bevel=0.04, parent=None):
    bevel = min(bevel, height * .48, radius * .8)
    rings = []
    for i in range(5):
        a = math.pi / 2 * i / 4
        inset = bevel * (1 - math.sin(a))
        z = -height / 2 + bevel * (1 - math.cos(a))
        rings.append((z, width - 2 * inset, depth - 2 * inset, max(.008, radius - inset)))
    for i in range(5):
        a = math.pi / 2 * i / 4
        inset = bevel * (1 - math.cos(a))
        z = height / 2 - bevel + bevel * math.sin(a)
        rings.append((z, width - 2 * inset, depth - 2 * inset, max(.008, radius - inset)))
    return profile_solid(name, rings, [mat], parent, location, steps=6)


def boolean_difference(obj, cutter):
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new('Machined recess', 'BOOLEAN')
    modifier.operation = 'DIFFERENCE'
    modifier.solver = 'EXACT'
    modifier.object = cutter
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def ring(name, width, depth, radius, border, z, mat, location=(0, 0, 0), parent=None):
    outer = outline(width, depth, radius, 12)
    inner = outline(width - 2 * border, depth - 2 * border, max(.01, radius - border), 12)
    n = len(outer)
    verts = [(x, y, z) for x, y in outer + inner]
    faces = [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    mesh = bpy.data.meshes.new(name + 'Mesh')
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(mat)
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    ob.location = location
    ob.parent = parent
    return ob


def cylinder(name, radius, depth, location, mat, axis='X', vertices=48, parent=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    if axis == 'X':
        obj.rotation_euler.y = math.pi / 2
    obj.data.materials.append(mat)
    bevel = obj.modifiers.new('Precision end radius', 'BEVEL')
    bevel.width = .025
    bevel.segments = 3
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    for poly in obj.data.polygons:
        poly.use_smooth = len(poly.vertices) == 4
    return obj


def join_objects(objects, name, parent=None):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    return obj


def build_device(revision):
    metal = material('MetalMat', (.56, .59, .62), 1, .34 if revision == 0 else .31)
    edge = material('EdgeMat', (.67, .69, .72), 1, .22)
    keys = material('KeyMat', (.011, .014, .018) if revision >= 3 else (.019, .023, .028),
                    0, .52 if revision >= 2 else .41)
    if revision >= 2:
        keys.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value = .24
    padmat = material('PadMat', (.28, .30, .32) if revision >= 2 else (.39, .42, .45),
                      .32 if revision >= 2 else .72, .38)
    if revision >= 4:
        shader = padmat.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value = (.12, .14, .17, 1)
        shader.inputs['Metallic'].default_value = .25
        shader.inputs['Roughness'].default_value = .45
        padmat.diffuse_color = (.12, .14, .17, 1)
    feetmat = material('FootMat', (.018, .021, .023), 0, .72)
    bezel = material('BezelMat', (.008, .010, .014), .12, .23)
    screenmat = material('ScreenMat', (0, 0, 0), 0, .12 if revision >= 3 else .18)
    if revision >= 3:
        screenmat.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value = .22
    screenmat.node_tree.nodes.get('Principled BSDF').inputs['Emission Color'].default_value = (0, 0, 0, 1)
    screenmat.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value = 1
    recess = material('RecessMat', (.018, .024, .030) if revision >= 3 else (.055, .062, .070),
                      .0 if revision >= 3 else .65, .52 if revision >= 3 else .38)
    holesmat = material('PerforationMat', (.012, .016, .020), .1, .65)
    root = bpy.data.objects.new('Laptop', None)
    bpy.context.collection.objects.link(root)
    base = profile_solid('Base', [(-.55, 30.70, 21.50, .52),
                                  (-.53, 30.82, 21.62, .56),
                                  (-.47, 30.98, 21.78, .60),
                                  (-.36, 31.08, 21.88, .64),
                                  (-.12, 31.20, 22.00, .66),
                                  (.37, 31.20, 22.00, .66),
                                  (.45, 31.16, 21.96, .64),
                                  (.51, 31.07, 21.87, .60),
                                  (.55, 30.92, 21.72, .54)],
                         [metal, edge], root, strip_mats=[0, 0, 0, 0, 0, 0, 0, 1])
    cutter = box('KeyboardTool', 26.3, 10.40, .85, (0, 3.25, .78), metal, .43, .12)
    boolean_difference(base, cutter)
    box('KeyboardWell', 26.13, 10.24, .06, (0, 3.25, .375), recess, .36, .018, root)
    cutter = box('TrackpadTool', 11.90, 5.60, .55, (0, -6.18, .68), metal, .27, .035)
    boolean_difference(base, cutter)
    box('TrackpadGasket', 11.85, 5.55, .03, (0, -6.18, .421), recess, .24, .008, root)
    box('Trackpad', 11.72, 5.42, .095, (0, -6.18, .488), padmat, .20, .025, root)
    ring('TrackpadChamfer', 11.74, 5.44, .22, .026, .537, edge, (0, -6.18, 0), root)

    key_objects = []
    def row(name, weights, y, depth, pitch=1.76):
        widths = [v * pitch - .14 for v in weights]
        total = sum(widths) + .14 * (len(widths) - 1)
        x = -total / 2
        for i, w in enumerate(widths):
            key_objects.append(box(f'{name}_{i:02}', w, depth, .125, (x + w / 2, y, .4475),
                                   keys, .105 if revision == 0 else .075,
                                   .045 if revision == 0 else .028, root))
            x += w + .14

    row('Function', [1] * 14, 7.70, .81, 1.81)
    row('Number', [1] * 13 + [1.5], 6.19, 1.48)
    row('Upper', [1.5] + [1] * 12 + [1], 4.48, 1.48)
    row('Home', [1.75] + [1] * 11 + [1.75], 2.77, 1.48)
    row('Lower', [2.1] + [1] * 10 + [2.4], 1.06, 1.48)
    weights = [1.1, 1, 1, 1.2, 5.4, 1.1, 1.1]
    x = -12.69
    for i, weight in enumerate(weights):
        w = weight * 1.76 - .14
        key_objects.append(box(f'Modifier_{i:02}', w, 1.43, .125, (x + w / 2, -.65, .4475), keys, .075, .028, root))
        x += w + .14
    for i in range(3):
        key_objects.append(box(f'Arrow_{i}', 1.13, .65, .125, (9.19 + i * 1.28, -1.045, .4475), keys, .075, .025, root))
    key_objects.append(box('Arrow_up', 1.13, .65, .125, (10.47, -.265, .4475), keys, .075, .025, root))
    assert len(key_objects) == 78, len(key_objects)
    keyboard = join_objects(key_objects, 'Keyboard_78Keys', root)

    # One combined cutter keeps the 564 blind perforations inexpensive to build.
    speaker_parts = []
    bore_vertices, bore_faces = [], []
    for side in (-1, 1):
        for col in range(6):
            for j in range(47):
                x = side * (13.60 + col * .168)
                y = -.60 + j * .168 + (col % 2) * .084
                r = .040 if revision == 0 else .032
                if revision >= 3:
                    start = len(bore_vertices)
                    for z, radius in ((.490, .028), (.540, .028), (.550, .036), (.650, .036)):
                        bore_vertices.extend((x + radius * math.cos(i * math.tau / 8),
                                              y + radius * math.sin(i * math.tau / 8), z) for i in range(8))
                    bore_faces.append(tuple(start + i for i in reversed(range(8))))
                    for layer in range(3):
                        for i in range(8):
                            a, b = start + layer * 8 + i, start + layer * 8 + (i + 1) % 8
                            bore_faces.append((a, b, b + 8, a + 8))
                    bore_faces.append(tuple(start + 24 + i for i in range(8)))
                    r = .0275
                verts = [(x + r * math.cos(i * math.tau / 8), y + r * math.sin(i * math.tau / 8),
                          .491 if revision >= 3 else .552) for i in range(8)]
                mesh = bpy.data.meshes.new('Aperture')
                mesh.from_pydata(verts, [], [tuple(range(8))])
                mesh.materials.append(holesmat)
                ob = bpy.data.objects.new('Aperture', mesh)
                bpy.context.collection.objects.link(ob)
                speaker_parts.append(ob)
    if bore_vertices:
        cutter_mesh = bpy.data.meshes.new('MicroBores')
        cutter_mesh.from_pydata(bore_vertices, [], bore_faces)
        if revision >= 4:
            base.data.materials.append(holesmat)
            for mat in base.data.materials:
                cutter_mesh.materials.append(mat)
            for poly in cutter_mesh.polygons:
                poly.material_index = len(base.data.materials) - 1
        cutter = bpy.data.objects.new('PerforationTool', cutter_mesh)
        bpy.context.collection.objects.link(cutter)
        boolean_difference(base, cutter)
    join_objects(speaker_parts, 'SpeakerPerforations', root)

    for x in (-12.8, 12.8):
        for y in (-8.35, 8.15):
            box(f'Foot_{x}_{y}', 1.70, .78, .14, (x, y, -.57), feetmat, .37, .05, root)
    for side in (-1, 1):
        if revision >= 2:
            cutter = box('HingePocketTool', 6.48, 1.05, .65, (side * 7.15, 10.60, .50), metal, .23, .08)
            boolean_difference(base, cutter)
            box(f'HingePocket_{side}', 6.34, .98, .035, (side * 7.15, 10.58, .191), recess, .18, .012, root)
        cylinder(f'HingeClutch_{side}', .205, 6.00, (side * 7.15, 10.70, .335),
                 metal if revision >= 2 else recess, parent=root)
        for offset in (-2.99, 2.99):
            cylinder(f'HingeCollar_{side}_{offset}', .211, .14, (side * 7.15 + offset, 10.70, .335), edge, parent=root)
        box(f'HingeMount_{side}', 5.3, .57, .17, (side * 7.15, 10.24, .42), metal, .15, .04, root)

    if revision >= 2:
        for i, y in enumerate((6.40, 3.80)):
            cutter = box('PortTool', .96, .29, .38, (-15.57, y, .015), metal, .14, .025)
            cutter.rotation_euler = (math.pi / 2, 0, math.pi / 2)
            boolean_difference(base, cutter)
            insert = box(f'USB_C_Recess_{i}', .91, .25, .035, (-15.39, y, .015), holesmat, .12, .008, root)
            insert.rotation_euler = (math.pi / 2, 0, math.pi / 2)
            tongue = box(f'USB_C_Tongue_{i}', .66, .055, .08, (-15.45, y, .015), recess, .025, .014, root)
            tongue.rotation_euler = (math.pi / 2, 0, math.pi / 2)

    lid = bpy.data.objects.new('Lid', None)
    bpy.context.collection.objects.link(lid)
    lid.parent = root
    lid.location = (0, 10.8, .55)
    profile_solid('LidShell', [(0, 30.94, 21.34, .51),
                              (.028, 31.07, 21.47, .56),
                              (.078, 31.17, 21.57, .61),
                              (.15, 31.20, 21.60, .63),
                              (.38, 31.20, 21.60, .63),
                              (.47, 31.13, 21.53, .60),
                              (.525, 31.00, 21.40, .54),
                              (.55, 30.87, 21.27, .49)],
                  [metal, edge], lid, (0, -10.8, 0), [1, 1, 0, 0, 0, 0, 0])
    glass = box('Bezel', 30.66, 21.08, .008, (0, -10.8, -.001), bezel, .45, .003, lid)
    ring('DisplaySeal', 30.86, 21.28, .49, .10, -.003, feetmat, (0, -10.8, 0), lid)
    mesh = bpy.data.meshes.new('ScreenMesh')
    # Facing -Z in Blender becomes -Y in glTF; UV top is the lid's free edge.
    mesh.from_pydata([(-14.8, -8.325, 0), (-14.8, 8.325, 0),
                     (14.8, 8.325, 0), (14.8, -8.325, 0)], [], [(0, 1, 2, 3)])
    mesh.materials.append(screenmat)
    mesh.uv_layers.new(name='UVMap')
    for loop, uv in zip(mesh.uv_layers.active.data, [(0, 1), (0, 0), (1, 0), (1, 1)]):
        loop.uv = uv
    screen = bpy.data.objects.new('Screen', mesh)
    bpy.context.collection.objects.link(screen)
    screen.parent = lid
    screen.location = (0, -10.8, -.006)
    root['units'] = 'centimetres; 1 unit = 1 cm'
    lid['open_angle_degrees'] = 112
    keyboard['key_count'] = 78
    return root, lid, screen, keyboard


def glb_json(path):
    data = path.read_bytes()
    length, kind = struct.unpack_from('<II', data, 12)
    assert kind == 0x4E4F534A
    return json.loads(data[20:20 + length])


def measure_glb(path, report_path):
    doc = glb_json(path)
    names = {node['name']: i for i, node in enumerate(doc['nodes'])}
    lid = doc['nodes'][names['Lid']]
    screen = doc['nodes'][names['Screen']]
    assert names['Screen'] in lid['children']
    assert max(abs(a - b) for a, b in zip(lid['translation'], [0, .55, -10.8])) < 1e-5
    assert max(abs(a - b) for a, b in zip(screen['translation'], [0, -.006, 10.8])) < 1e-5
    assert lid.get('rotation', [0, 0, 0, 1]) == [0, 0, 0, 1]
    triangles = sum(doc['accessors'][p['indices']]['count'] // 3 for m in doc['meshes'] for p in m['primitives'])
    assert triangles < 150000, triangles
    assert path.stat().st_size < 8_000_000, path.stat().st_size
    assert not any(x in doc.get('extensionsUsed', []) for x in ('KHR_draco_mesh_compression', 'EXT_meshopt_compression'))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()
    imported_lid = bpy.data.objects['Lid']
    imported_screen = bpy.data.objects['Screen']
    def yup(v):
        return [round(v.x, 6), round(v.z, 6), round(-v.y, 6)]
    def bounds(obj):
        verts = [obj.matrix_world @ v.co for v in obj.data.vertices]
        values = [yup(v) for v in verts]
        return {'min': [min(v[i] for v in values) for i in range(3)],
                'max': [max(v[i] for v in values) for i in range(3)]}
    screen_normal = imported_screen.data.polygons[0].normal
    uvs = [tuple(round(c, 6) for c in loop.uv) for loop in imported_screen.data.uv_layers.active.data]
    report = {'units': '1 unit = 1 cm; all positions below in glTF Y-up space',
              'hinge_world': yup(imported_lid.matrix_world.translation),
              'lid_gltf_rotation_xyzw': lid.get('rotation', [0, 0, 0, 1]),
              'screen_local_center': yup(imported_screen.location),
              'screen_world_center_closed': yup(imported_screen.matrix_world.translation),
              'screen_local_normal': yup(screen_normal),
              'screen_uv_corners': sorted(set(uvs)),
              'base_bounds': bounds(bpy.data.objects['Base']),
              'lid_shell_bounds_closed': bounds(bpy.data.objects['LidShell']),
              'screen_bounds_closed': bounds(imported_screen),
              'keyboard_bounds': bounds(bpy.data.objects['Keyboard_78Keys']),
              'key_count': bpy.data.objects['Keyboard_78Keys']['key_count'],
              'triangles': triangles, 'file_bytes': path.stat().st_size,
              'mesh_nodes': sorted(o.name for o in bpy.context.scene.objects if o.type == 'MESH'),
              'materials': sorted(m.name for m in bpy.data.materials),
              'extensions_used': doc.get('extensionsUsed', [])}
    assert abs(report['base_bounds']['min'][1] + .55) < 1e-5
    assert abs(report['base_bounds']['max'][1] - .55) < 1e-5
    assert report['keyboard_bounds']['max'][1] <= .55
    assert imported_screen.parent == imported_lid
    assert report['screen_uv_corners'] == [(0, 0), (0, 1), (1, 0), (1, 1)]
    assert report['screen_local_normal'] == [0, -1, 0]
    assert report['key_count'] == 78
    for name, expected in (('base_bounds', ([-15.6, -.55, -11], [15.6, .55, 11])),
                           ('lid_shell_bounds_closed', ([-15.6, .55, -10.8], [15.6, 1.1, 10.8])),
                           ('screen_bounds_closed', ([-14.8, .544, -8.325], [14.8, .544, 8.325]))):
        for extreme, target in zip(('min', 'max'), expected):
            assert max(abs(a - b) for a, b in zip(report[name][extreme], target)) < 1e-5, name
    imported_lid.rotation_mode = 'XYZ'
    imported_lid.rotation_euler.x = -math.radians(112)
    bpy.context.view_layer.update()
    report['screen_world_center_open_112deg'] = yup(imported_screen.matrix_world.translation)
    assert report['screen_world_center_open_112deg'][1] > 10
    assert report['screen_world_center_open_112deg'][2] < -14
    imported_lid.rotation_euler.x = 0
    bpy.context.view_layer.update()
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print('VERIFIED_GLTF ' + json.dumps(report), flush=True)
    return imported_lid


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def area(name, location, target, power, size, color=(1, 1, 1), size_y=None):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = power
    data.color = color
    data.shape = 'RECTANGLE'
    data.size = size
    data.size_y = size_y if size_y else size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    point_at(obj, target)


def studio(revision, samples, width):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 8
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for mode in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = mode
            prefs.get_devices()
            gpu = [d for d in prefs.devices if d.type == mode]
            if gpu:
                for device in prefs.devices:
                    device.use = device.type == mode
                scene.cycles.device = 'GPU'
                print('CYCLES_DEVICE', mode, [d.name for d in gpu], flush=True)
                break
        except Exception:
            continue
    scene.render.resolution_x = width
    scene.render.resolution_y = round(width * 9 / 16)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    world = bpy.data.worlds.new('NeutralStudio')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (.30, .33, .38, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = .24
    scene.world = world
    ground = material('StudioGround', (.009, .012, .016) if revision >= 3 else (.018, .021, .027),
                      0 if revision >= 3 else .1, .70 if revision >= 3 else .48)
    box('StudioFloor', 2000, 2000, .2, (0, 0, -.77), ground, .2, .03)
    area('KeySoftbox', (-18, -14, 35), (0, 0, 0), 21000, 24, (1, .97, .93), 20)
    area('RimStrip', (6, 23, 30), (0, 0, 7), 27000, 26, (.91, .95, 1), 8)
    area('RightFill', (30, 15, 22) if revision >= 4 else (26, -3, 17),
         (0, 0, 6), 11500, 18, (.97, .98, 1), 26)
    if revision >= 1:
        area('FrontEdgeStrip', (-8, -28, 9), (0, 0, 0), 5000, 27, (1, 1, 1), 4)
    camdata = bpy.data.cameras.new('PreviewCamera')
    cam = bpy.data.objects.new('PreviewCamera', camdata)
    bpy.context.collection.objects.link(cam)
    camdata.type = 'ORTHO'
    camdata.lens = 55
    camdata.clip_end = 3000
    scene.camera = cam
    return cam


def render_views(lid, out, revision, samples, width, selected):
    cam = studio(revision, samples, width)
    # glTF imports quaternions; Euler updates otherwise leave the lid shut.
    lid.rotation_mode = 'XYZ'
    views = {'open': (112, (-38, -49, 34), (0, 1.5, 9), 53),
             'half-closed': (48, (-37, -48, 29), (0, 0, 5), 49),
             'closed': (0, (-37, -48, 29), (0, 0, .2), 45),
             'keyboard-hinge': (112, (-24, -29, 34), (0, 3, 1.6), 36)}
    if revision >= 2:
        views['open'] = (112, (-38, -49, 34), (0, 2, 10.0), 66)
        views['half-closed'] = (48, (-37, -48, 29), (0, 0, 5), 54)
        views['keyboard-hinge'] = (112, (-19, -28, 37), (0, 3.8, 1.5), 37)
    if revision >= 3:
        views['open'] = (112, (-38, -49, 34), (0, 2, 10.0), 71)
    scene = bpy.context.scene
    for name in selected:
        angle, position, target, scale = views[name]
        lid.rotation_euler.x = -math.radians(angle)
        cam.location = position
        point_at(cam, target)
        cam.data.ortho_scale = scale
        bpy.context.view_layer.update()
        scene.render.filepath = str(out / (name + '.png'))
        print('RENDERING', name, flush=True)
        bpy.ops.render.render(write_still=True)
    lid.rotation_euler.x = 0


def main():
    args = arguments()
    out_dir = (args.out_dir or Path(__file__).resolve().parent).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    preview_dir = out_dir / 'previews'
    if args.pass_number < 4:
        preview_dir /= f'pass-{args.pass_number}'
    preview_dir.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'NONE'
    root, lid, screen, keyboard = build_device(args.pass_number)
    path = out_dir / 'laptop.glb' if args.out_dir else out_dir.parent / 'public' / 'models' / 'laptop.glb'
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
                             export_yup=True, export_apply=True, export_extras=True,
                             export_cameras=False, export_lights=False, export_animations=False)
    lid = measure_glb(path, out_dir / 'measurements.json')
    if not args.skip_render:
        render_views(lid, preview_dir, args.pass_number, args.samples, args.width, args.render_only.split(','))


if __name__ == '__main__':
    main()
