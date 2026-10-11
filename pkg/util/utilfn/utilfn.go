// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package utilfn

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"hash/fnv"
	"io"
	"log"
	"os"
	"reflect"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"text/template"
	"time"
)

var PTLoc *time.Location

func init() {
	loc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		loc = time.FixedZone("PT", -8*60*60)
	}
	PTLoc = loc
}

var needsQuoteRe = regexp.MustCompile(`[^\w@%:,./=+-]`)

// minimum maxlen=6, pass -1 for no max length
func ShellQuote(val string, forceQuote bool, maxLen int) string {
	if maxLen != -1 && maxLen < 6 {
		maxLen = 6
	}
	rtn := val
	if needsQuoteRe.MatchString(val) {
		rtn = "'" + strings.ReplaceAll(val, "'", `'"'"'`) + "'"
	} else if forceQuote {
		rtn = "\"" + rtn + "\""
	}
	if maxLen == -1 || len(rtn) <= maxLen {
		return rtn
	}
	if strings.HasPrefix(rtn, "\"") || strings.HasPrefix(rtn, "'") {
		return rtn[0:maxLen-4] + "..." + rtn[len(rtn)-1:]
	}
	return rtn[0:maxLen-3] + "..."
}

func ContainsStr(strs []string, test string) bool {
	for _, s := range strs {
		if s == test {
			return true
		}
	}
	return false
}

func GetOrderedMapKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func GetMapKeys[K comparable, V any](m map[K]V) []K {
	var rtn []K
	for key := range m {
		rtn = append(rtn, key)
	}
	return rtn
}

func StrSetIntersection(s1 []string, s2 []string) []string {
	set := make(map[string]bool)
	for _, s := range s1 {
		set[s] = true
	}
	var rtn []string
	for _, s := range s2 {
		if set[s] {
			rtn = append(rtn, s)
		}
	}
	return rtn
}

func IndentString(indent string, str string) string {
	splitArr := strings.Split(str, "\n")
	var rtn strings.Builder
	for _, line := range splitArr {
		if line == "" {
			rtn.WriteByte('\n')
			continue
		}
		rtn.WriteString(indent)
		rtn.WriteString(line)
		rtn.WriteByte('\n')
	}
	return rtn.String()
}

func SliceIdx[T comparable](arr []T, elem T) int {
	for idx, e := range arr {
		if e == elem {
			return idx
		}
	}
	return -1
}

// removes an element from a slice and modifies the original slice (the backing elements)
// if it removes the last element from the slice, it will return nil so we free the original slice's backing memory
func RemoveElemFromSlice[T comparable](arr []T, elem T) []T {
	idx := SliceIdx(arr, elem)
	if idx == -1 {
		return arr
	}
	if len(arr) == 1 {
		return nil
	}
	return append(arr[:idx], arr[idx+1:]...)
}

func AddElemToSliceUniq[T comparable](arr []T, elem T) []T {
	if SliceIdx(arr, elem) != -1 {
		return arr
	}
	return append(arr, elem)
}

func MoveSliceIdxToFront[T any](arr []T, idx int) []T {
	// create and return a new slice with idx moved to the front
	if idx == 0 || idx >= len(arr) {
		// make a copy still
		return append([]T(nil), arr...)
	}
	rtn := make([]T, 0, len(arr))
	rtn = append(rtn, arr[idx])
	rtn = append(rtn, arr[0:idx]...)
	rtn = append(rtn, arr[idx+1:]...)
	return rtn
}

// matches a delimited string with a pattern string
// the pattern string can contain "*" to match a single part, or "**" to match the rest of the string
// note that "**" may only appear at the end of the string
func StarMatchString(pattern string, s string, delimiter string) bool {
	patternParts := strings.Split(pattern, delimiter)
	stringParts := strings.Split(s, delimiter)
	pLen, sLen := len(patternParts), len(stringParts)

	for i := 0; i < pLen; i++ {
		if patternParts[i] == "**" {
			// '**' must be at the end to be valid
			return i == pLen-1
		}
		if i >= sLen {
			// If string is exhausted but pattern is not
			return false
		}
		if patternParts[i] != "*" && patternParts[i] != stringParts[i] {
			// If current parts don't match and pattern part is not '*'
			return false
		}
	}
	// Check if both pattern and string are fully matched
	return pLen == sLen
}

func AtomicRenameCopy(dstPath string, srcPath string, perms os.FileMode) error {
	// first copy the file to dstPath.new, then rename into place
	srcFd, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer srcFd.Close()
	tempName := dstPath + ".new"
	dstFd, err := os.Create(tempName)
	if err != nil {
		return err
	}
	_, err = io.Copy(dstFd, srcFd)
	if err != nil {
		dstFd.Close()
		return err
	}
	err = dstFd.Close()
	if err != nil {
		return err
	}
	err = os.Chmod(tempName, perms)
	if err != nil {
		return err
	}
	err = os.Rename(tempName, dstPath)
	if err != nil {
		return err
	}
	return nil
}

func WriteTemplateToFile(fileName string, templateText string, vars map[string]string) error {
	outBuffer := &bytes.Buffer{}
	template.Must(template.New("").Parse(templateText)).Execute(outBuffer, vars)
	return os.WriteFile(fileName, outBuffer.Bytes(), 0644)
}

// every byte is 4-bits of randomness
func RandomHexString(numHexDigits int) (string, error) {
	numBytes := (numHexDigits + 1) / 2 // Calculate the number of bytes needed
	bytes := make([]byte, numBytes)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}

	hexStr := hex.EncodeToString(bytes)
	return hexStr[:numHexDigits], nil // Return the exact number of hex digits
}

func GetJsonTag(field reflect.StructField) string {
	jsonTag := field.Tag.Get("json")
	if jsonTag == "" {
		return ""
	}
	commaIdx := strings.Index(jsonTag, ",")
	if commaIdx != -1 {
		jsonTag = jsonTag[:commaIdx]
	}
	return jsonTag
}

func WriteFileIfDifferent(fileName string, contents []byte) (bool, error) {
	oldContents, err := os.ReadFile(fileName)
	if err == nil && bytes.Equal(oldContents, contents) {
		return false, nil
	}
	err = os.WriteFile(fileName, contents, 0644)
	if err != nil {
		return false, err
	}
	return true, nil
}

func GetLineColFromOffset(barr []byte, offset int) (int, int) {
	line := 1
	col := 1
	for i := 0; i < offset && i < len(barr); i++ {
		if barr[i] == '\n' {
			line++
			col = 1
		} else {
			col++
		}
	}
	return line, col
}

func FindStringInSlice(slice []string, val string) int {
	for idx, v := range slice {
		if v == val {
			return idx
		}
	}
	return -1
}

func FormatLsTime(t time.Time) string {
	now := time.Now()
	sixMonthsAgo := now.AddDate(0, -6, 0)

	if t.After(sixMonthsAgo) {
		// Recent files: "Nov 18 18:40"
		return t.Format("Jan _2 15:04")
	} else {
		// Older files: "Apr 12  2025"
		return t.Format("Jan _2  2006")
	}
}

/**
 * Helper function that will deref a pointer if not null
 * but returns a default value if it is null.
 */
func SafeDeref[T any](x *T) T {
	if x == nil {
		var safeOut T
		return safeOut
	}
	return *x
}

/**
 * Utility function for referencing a type with a pointer.
 * This is the same as dereferencing with &, but unlike &
 * you can directly use it on the ouput of a function
 * without needing to create an intermediate variable
 */
func Ptr[T any](x T) *T {
	return &x
}

func TimeoutFromContext(ctx context.Context, defaultTimeout time.Duration) time.Duration {
	deadline, ok := ctx.Deadline()
	if !ok {
		return defaultTimeout
	}
	return time.Until(deadline)
}

func HasBinaryData(data []byte) bool {
	for _, b := range data {
		if b < 32 && b != '\n' && b != '\r' && b != '\t' && b != '\f' && b != '\b' {
			return true
		}
	}
	return false
}

func DumpGoRoutineStacks(w io.Writer) {
	buf := make([]byte, 1<<20)
	n := runtime.Stack(buf, true)
	w.Write(buf[:n])
}

func ConvertToWallClockPT(t time.Time) time.Time {
	year, month, day := t.Date()
	hour, min, sec := t.Clock()
	pstTime := time.Date(year, month, day, hour, min, sec, 0, PTLoc)
	return pstTime
}

func QuickHashString(s string) string {
	h := fnv.New64a()
	h.Write([]byte(s))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

const (
	maxRetries = 5
	retryDelay = 10 * time.Millisecond
)

func GracefulClose(closer io.Closer, debugName, closerName string) bool {
	closed := false
	for retries := 0; retries < maxRetries; retries++ {
		if err := closer.Close(); err != nil {
			log.Printf("%s: error closing %s: %v, trying again in %dms\n", debugName, closerName, err, retryDelay.Milliseconds())
			time.Sleep(retryDelay)
			continue
		}
		closed = true
		break
	}
	if !closed {
		log.Printf("%s: unable to close %s after %d retries\n", debugName, closerName, maxRetries)
	}
	return closed
}

// DrainChannelSafe will drain a channel until it is empty or until a timeout is reached.
func DrainChannelSafe[T any](ch <-chan T, debugName string) {
	drainTimeoutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	go func() {
		defer cancel()
	outer:
		for {
			select {
			case <-drainTimeoutCtx.Done():
				log.Printf("[error] timeout draining channel: %s\n", debugName)
				break outer
			case _, ok := <-ch:
				if !ok {
					return
				}
			}
		}
	}()
}
