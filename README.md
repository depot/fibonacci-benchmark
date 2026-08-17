# fibonacci-benchmark
Fibonacci benchmark workflows

## Usage

### Parameters

`DEPTH`: fibonacci depth `default`: 20  
`POLL_MS`:  api poll freqency in ms `default`: 3000  
`TIMEOUT_MS`: timeouts benchmark after n milliseconds `default`: 1800000  

### Depot benchmark

#### sequential

```bash
DEPOT_TOKEN=x pnpm run benchmark:depot
```

#### concurrent
```
DEPOT_TOKEN=x pnpm run benchmark:depot:concurrent
```

### Github benchmark

#### sequential

```bash
GITHUB_TOKEN=x pnpm run benchmark:github
```

#### concurrent
```
GITHUB_TOKEN=x pnpm run benchmark:github:concurrent
```
