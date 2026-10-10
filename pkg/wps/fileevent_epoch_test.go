// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wps

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"
)

// The frontend drops term-file Append events whose fileepoch doesn't match the current epoch
// (a missing field reads as 0), so every publisher must fill FileEpoch from the append API.
func TestAllFileAppendPublishersSetFileEpoch(t *testing.T) {
	pkgRoot, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	numPublishers := 0
	walkErr := filepath.WalkDir(pkgRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			return err
		}
		ast.Inspect(file, func(n ast.Node) bool {
			lit, ok := n.(*ast.CompositeLit)
			if !ok || !isFileEventDataType(lit.Type) {
				return true
			}
			isAppend := false
			hasEpoch := false
			for _, elt := range lit.Elts {
				kv, ok := elt.(*ast.KeyValueExpr)
				if !ok {
					continue
				}
				key, ok := kv.Key.(*ast.Ident)
				if !ok {
					continue
				}
				switch key.Name {
				case "FileOp":
					if sel, ok := kv.Value.(*ast.SelectorExpr); ok && sel.Sel.Name == "FileOp_Append" {
						isAppend = true
					}
				case "FileEpoch":
					hasEpoch = true
				}
			}
			if isAppend {
				numPublishers++
				if !hasEpoch {
					t.Errorf("%s: WSFileEventData append event without FileEpoch", fset.Position(lit.Pos()))
				}
			}
			return true
		})
		return nil
	})
	if walkErr != nil {
		t.Fatal(walkErr)
	}
	// blockcontroller.HandleAppendBlockFile and jobcontroller.doWFSAppend at the time of writing
	if numPublishers < 2 {
		t.Fatalf("found only %d append publishers; the scan is probably broken", numPublishers)
	}
}

func isFileEventDataType(expr ast.Expr) bool {
	switch typ := expr.(type) {
	case *ast.SelectorExpr:
		return typ.Sel.Name == "WSFileEventData"
	case *ast.Ident:
		return typ.Name == "WSFileEventData"
	}
	return false
}
