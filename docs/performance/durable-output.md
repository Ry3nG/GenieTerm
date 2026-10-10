# Durable output throughput

Measured on darwin/arm64, Go 1.27.2, from baseline `479a73cf` on `perf-durable`.
Raw runs: [baseline](durable-baseline.txt), [after](durable-after.txt).

## Harness

`pkg/jobmanager/throughput_test.go` connects the production stream manager and
stream reader through independent FIFO data/ACK links with fixed one-way delay.
The PTY-side substitute is an `io.Pipe`: 200,000 individual writes of `abcdef\n`
(1,400,000 bytes), or one 10 MiB write. Every byte and terminal EOF are verified.
Transfer timing ends at delivery of the last payload byte; EOF is verified afterward.
Packet counts include EOF. Echo timing starts before a one-byte write after idle.

`TestDurableThroughput` measures wall-clock performance, including scheduling and
CPU overhead. `TestDurableVirtualThroughput` runs the same harness under
`testing/synctest` with deterministic virtual link/timer time. Virtual durations
are protocol timing checks, not CPU throughput measurements. The echo timing test
also asserts exact one-way latency under virtual time. Heavy workloads skip under
`testing.Short()`. The legacy-window test stops the consumer, fills the receive
window, then verifies recovery and exact delivery with a 64 KiB receiver.

Reproduce (from the repository root):

```sh
export GOCACHE=$PWD/.gocache
go test ./pkg/jobmanager -run 'TestDurable(Throughput|EchoLatency)$' -count=1 -v
go test ./pkg/jobmanager -run 'TestDurable(VirtualThroughput|DeterministicLink|LegacyReceiveWindow)$' -count=1 -v
```

This is an in-process stream measurement, not an SSH, WaveFS, websocket, or renderer
benchmark. Links have propagation delay but no bandwidth cap or serialization cost.
Wall-clock timings and packet counts vary with scheduling; no throughput thresholds
are imposed on CI. The baseline was measured before changing production code.

## Before / after

| One-way delay | 200k lines before → after | 10 MiB before → after | Bulk MiB/s before → after |
|---|---|---|---|
| 0 ms | 146.27 → 117.95 ms | 100.37 → 14.42 ms | 99.64 → 693.25 |
| 10 ms | 450.33 → 142.21 ms | 3535.15 → 101.10 ms | 2.83 → 98.91 |
| 50 ms | 2200.03 → 240.76 ms | 16290.02 → 478.39 ms | 0.61 → 20.90 |

Median idle echo latency, three samples at each delay:

| One-way delay | Before | After |
|---|---|---|
| 0 ms | 35.46 µs | 30.42 µs |
| 10 ms | 11.111 ms | 11.056 ms |
| 50 ms | 51.067 ms | 51.051 ms |

At zero delay the line workload fell from 78,320 packets / 118,553 ACKs to
32 packets / 63 ACKs. Bulk fell from 2,561 packets to 161 at every delay.

## Changes and compatibility

- Sender congestion window: 64 KiB → 2 MiB; local advertised receive window:
  64 KiB → 2 MiB. The circular buffer remains 2 MiB. The sender still obeys the
  smaller of its congestion window and the receiver's advertised window.
- Maximum payload and PTY read size: 4 KiB → 64 KiB. A 64 KiB payload encodes to
  87,384 base64 bytes. The existing reader decodes variable-sized payloads;
  packet framing uses `ReadBytes`, and the OSC encoder permits
  64 MiB messages. No wire fields or RPC definitions changed.
- The first packet after idle sends immediately. Subsequent short packets batch
  for at most 4 ms; full packets, exhausted windows, and EOF/error tails bypass
  that wait. ACKs remain immediate, avoiding delayed-ACK stalls for old senders.
- Circular-buffer reads/writes use at most two bulk copies instead of per-byte
  modulo operations. A deterministic slice-model test covers wrap, truncation,
  synchronous backpressure, window changes, empty writes, and sequence positions.
- Local reads are 64 KiB, so one received packet becomes one append event. The local
  output loop keeps its append-on-read semantics under `runIfCurrent`: wavesrv-side
  coalescing was measured but not adopted, because the receiver acks on receipt and a
  reconnect inside the batching window would drop already-acked bytes.

**Old job manager → new wavesrv:** existing 4 KiB packets, sequence numbers and
ACKs work unchanged. An old sender still caps itself at 64 KiB even when the local
receiver advertises 2 MiB, so it cannot gain the new high-RTT transport throughput.
It still benefits from the router and renderer batching on the local side.

**New job manager → old wavesrv:** the old receiver advertises 64 KiB, which the new
sender honors, including zero-window updates. The unchanged reader accepts 64 KiB
payloads. Immediate ACK semantics, EOF/error and reconnect sequencing remain the
same. The legacy-window integration test uses that unchanged reader with the old
window and deliberately exercises a paused consumer. These are source-level and
in-process compatibility checks, not tests of deployed historical executables.

## Validation and residual risks

The requested native, Windows and Linux `go vet` commands passed. Race tests passed
for jobmanager, streamclient and jobcontroller. Changed Go files are gofmt-clean; `git diff --check` is clean.

The larger window permits more queued output per connection (up to 2 MiB raw
receiver data, plus base64/queue overhead) and may increase shared-transport
head-of-line delay during saturation. The 2 MiB ring and sender flow-control bounds
remain enforced. A byte arriving during an active burst can wait up to 4 ms in the
sender; isolated idle keystrokes bypass it. Scheduler and storage delays are not hard real-time bounded.
ACKs still mean receipt, not durable file persistence: abrupt reconnects can discard
already-received but unappended bytes under the existing gap-handling semantics.
Real remote/renderer saturation and many simultaneous sessions remain to be profiled.
