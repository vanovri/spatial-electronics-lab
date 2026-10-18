from pathlib import Path
import tempfile
import unittest

from self_healing_gradle_loop import parse_gradle_errors,patch_known_diagnostics,GEOMETRY,ACTIVITY,CORRECT,BROKEN,IMPORT


class RepairTests(unittest.TestCase):
    def test_linux_and_windows_and_spaced_paths(self):
        output='e: file:///tmp/my%20project/Geometry.kt:18:31 Return type mismatch: expected Float, actual Double\ne: C:\\work\\MainActivity.kt:2:1: Unresolved reference: detectTransformGestures'
        result=parse_gradle_errors(output)
        self.assertEqual(len(result),2);self.assertEqual(result[0]['line'],18)
        self.assertEqual(result[0]['file'],'/tmp/my project/Geometry.kt')
        self.assertEqual(result[1]['file'],r'C:\work\MainActivity.kt')

    def test_known_repairs_are_local_and_idempotent(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);geometry=root/GEOMETRY;activity=root/ACTIVITY
            geometry.parent.mkdir(parents=True);geometry.write_text(BROKEN)
            activity.write_text('package id.autonomous.spatialmap\n\nfun main() {}\n')
            rows=[{'file':str(geometry),'message':'Return type mismatch: expected Float, actual Double'},
                  {'file':str(activity),'message':'Unresolved reference: detectTransformGestures'}]
            self.assertEqual(len(patch_known_diagnostics(root,rows)),2)
            self.assertEqual(geometry.read_text(),CORRECT);self.assertIn(IMPORT,activity.read_text())
            self.assertEqual(patch_known_diagnostics(root,rows),[])

    def test_unknown_files_and_unknown_errors_never_receive_patches(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);path=root/'Other.kt';path.write_text(BROKEN)
            self.assertEqual(patch_known_diagnostics(root,[{'file':str(path),'message':'Float Double'}]),[])
            self.assertEqual(path.read_text(),BROKEN)


if __name__=='__main__':unittest.main()
