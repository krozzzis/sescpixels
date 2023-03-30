# SESC pixels

## Requirement
- Rust, any new version. 1.69 works for sure
- sqlite3

## Start
```bash
# cargo run -- --port 8080 --width 200 --height 200 --db ./db.db
```

Play at [http://localhost:8080/play]()

Watchscreen with canvas and leaderboard at [http://localhost:8080/view]() (currently doesn't implemented)

It support some optional parametrs:
- --port - web server port
- --width - canvas width
- --height - canvas height
- --db - path to file where sqlite stores canvas, history and other data
