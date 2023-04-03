# SESC pixels

## Requirement
- Rust, any new version. 1.69 works for sure

## Start
```bash
# cargo run
```

Tutorial at [http://localhost:8080]()

Play at [http://localhost:8080/play]()

Watchscreen with canvas and leaderboard at [http://localhost:8080/view]()

It support some optional parametrs:
- --port - web server port(default=8080)
- --width - canvas width(default = 100)
- --height - canvas height(default = 100)
- --db - path to file where sqlite stores canvas, history and other data(default = ./db.db)
- --addr - which ip addreses listen(default = 127.0.0.1, to listen all incoming requests - 0.0.0.0)
