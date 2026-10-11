// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"strings"

	"github.com/Ry3nG/GenieTerm/pkg/remote/connparse"
	"github.com/Ry3nG/GenieTerm/pkg/util/fileutil"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc/wshclient"
	"github.com/Ry3nG/GenieTerm/pkg/wshutil"
)

func convertNotFoundErr(err error) error {
	if err == nil {
		return nil
	}
	if strings.HasPrefix(err.Error(), "NOTFOUND:") {
		return fs.ErrNotExist
	}
	return err
}

func ensureFile(fileData wshrpc.FileData) (*wshrpc.FileInfo, error) {
	info, err := wshclient.FileInfoCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: fileTimeout})
	err = convertNotFoundErr(err)
	if err == fs.ErrNotExist {
		err = wshclient.FileCreateCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: fileTimeout})
		if err != nil {
			return nil, fmt.Errorf("creating file: %w", err)
		}
		info, err = wshclient.FileInfoCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: fileTimeout})
		if err != nil {
			return nil, fmt.Errorf("getting file info: %w", err)
		}
		return info, err
	}
	if err != nil {
		return nil, fmt.Errorf("getting file info: %w", err)
	}
	return info, nil
}

func streamReadFromFile(ctx context.Context, fileData wshrpc.FileData, writer io.Writer) error {
	broker := RpcClient.StreamBroker
	if broker == nil {
		return fmt.Errorf("stream broker not available")
	}
	if fileData.Info == nil {
		return fmt.Errorf("file info is required")
	}
	readerRouteId := RpcClientRouteId
	if readerRouteId == "" {
		return fmt.Errorf("no route id available")
	}
	conn, err := connparse.ParseURI(fileData.Info.Path)
	if err != nil {
		return fmt.Errorf("parsing file path: %w", err)
	}
	writerRouteId := wshutil.MakeConnectionRouteId(conn.Host)
	reader, streamMeta := broker.CreateStreamReader(readerRouteId, writerRouteId, 256*1024)
	defer reader.Close()
	go func() {
		<-ctx.Done()
		reader.Close()
	}()
	data := wshrpc.CommandFileStreamData{
		Info:       fileData.Info,
		StreamMeta: *streamMeta,
	}
	_, err = wshclient.FileStreamCommand(RpcClient, data, nil)
	if err != nil {
		return fmt.Errorf("starting file stream: %w", err)
	}
	_, err = io.Copy(writer, reader)
	return err
}

func fixRelativePaths(path string) (string, error) {
	conn, err := connparse.ParseURI(path)
	if err != nil {
		return "", err
	}
	if conn.Scheme == connparse.ConnectionTypeWsh {
		if conn.Host == connparse.ConnHostCurrent {
			conn.Host = RpcContext.Conn
			fixedPath, err := fileutil.FixPath(conn.Path)
			if err != nil {
				return "", err
			}
			conn.Path = fixedPath
		}
		if conn.Host == "" {
			conn.Host = wshrpc.LocalConnName
		}
	}
	return conn.GetFullURI(), nil
}
