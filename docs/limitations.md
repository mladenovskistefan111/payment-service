# Known limitations

- Simulation only: no provider integration, no persistence, no idempotency (every call yields a new transaction ID).
- Logs the raw card details (see warning above).
- Every error is returned as `INVALID_ARGUMENT`, including unexpected internal failures.
- `SIGTERM` does not terminate the process; the Docker `HEALTHCHECK` depends on `PORT` being set.
