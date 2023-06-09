use std::{path::PathBuf, sync::Mutex};
use std::collections::HashMap;

use actix_web::{web, get, App, HttpRequest, HttpResponse, HttpServer, Responder, middleware};
use actix_files::{NamedFile, Files};

use clap::Parser;
use log::debug;

use rusqlite::Connection;
use serde::{Serialize, Deserialize};
use actix_governor::{Governor, GovernorConfigBuilder};

type ColorIndex = u8;

#[derive(Debug, Serialize)]
struct Canvas {
    width: usize,
    height: usize,
    pixels: Vec<ColorIndex>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Color(pub u8, pub u8, pub u8);

#[derive(Debug, Serialize, Deserialize)]
struct Palette {
    count: usize,
    colors: HashMap<ColorIndex, Color>,
    order: Vec<ColorIndex>,
}

#[derive(Debug)]
struct Pixel {
    x: usize,
    y: usize,
    color: ColorIndex,
}

#[derive(Debug, Clone, Deserialize)]
struct PutPixelEvent {
    x: usize,
    y: usize,
    color: ColorIndex,
    user: String,
    party: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct OutputPixelEvent {
    id: usize,
    x: usize,
    y: usize,
    width: usize,
    height: usize,
    color: ColorIndex,
}

struct Db {
    conn: Connection,
    canvas_width: usize,
    canvas_height: usize,
    history_height: usize,
    last_time: HashMap<String, usize>,
    cooldown: usize,
}

impl Db {
    pub fn new(conn: Connection, width: usize, height: usize, cooldown: usize, reinit: bool) -> rusqlite::Result<Self> {
        let mut sel = Self {
            conn,
            canvas_width: width,
            canvas_height: height,
            history_height: 1,
            cooldown,
            last_time: HashMap::new(),
        };
        sel.create_tables()?;
        if reinit {
            sel.create_canvas(width, height)?;
        }
        sel.update_history_height()?;
        Ok(sel)
    }

    fn create_tables(&self) -> rusqlite::Result<()> {
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS pixels (
                x        INTEGER,
                y        INTEGER,
                color    INTEGER,
                owner    TEXT,
                party    TEXT
            )",
            (),
        )?;
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS events (
                id       INTEGER PRIMARY KEY,
                time     INTEGER,
                x        INTEGER,
                y        INTEGER,
                color    INTEGER,
                owner    TEXT,
                party    TEXT
            )",
            (),
        )?;
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                name     TEXT UNIQUE,
                value    INTEGER
            )",
            (),
        )?;
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS user_data (
                name     TEXT,
                ip       TEXT,
                agent    TEXT
            )",
            (),
        )?;
        Ok(())
    }

    fn create_canvas(&self, width: usize, height: usize) -> rusqlite::Result<()> {
        self.conn.execute("INSERT INTO settings (name, value) SELECT 'width', ? WHERE NOT EXISTS (SELECT 'name' FROM settings WHERE name='width')", [width])?;
        self.conn.execute("INSERT INTO settings (name, value) SELECT 'height', ? WHERE NOT EXISTS (SELECT 'name' FROM settings WHERE name='height')", [height])?;
        self.conn.execute("UPDATE settings SET value = ? WHERE name = 'width'", [width])?;
        self.conn.execute("UPDATE settings SET value = ? WHERE name = 'height'", [height])?;
        println!("Initializing canvas in db");
        self.conn.execute("BEGIN", [])?;
        // for y in 0..height {
        //     for x in 0..width{
        //         self.conn.execute("INSERT INTO pixels (x, y, color, owner, party) SELECT ?1, ?2, ?3, ?4, ?5 WHERE NOT EXISTS (SELECT (x, y) FROM pixels WHERE x=?1 AND y=?2);", [x, y, 0, 0, 0])?;
        //     }
        // }
        self.conn.execute("INSERT INTO events (x, y, color, owner, party) VALUES (10000, 10000, 0, 0, 0)", [])?;
        self.conn.execute("END", [])?;
        Ok(())
    }

    fn get_canvas(&self) -> rusqlite::Result<Canvas> {
        let width = self.canvas_width;
        let height = self.canvas_height;

        let mut pixels = vec![0; width*height];
        let mut stmt = self.conn.prepare("SELECT x, y, color FROM pixels WHERE x < ?1 AND y < ?2")?;

        let pixels_iter = stmt.query_map([width, height], |row| {
            Ok(Pixel {
                x: row.get(0)?,
                y: row.get(1)?,
                color: row.get(2)?,
            })
        })?;
        for pixel in pixels_iter {
            if let Ok(pix) = pixel {
                pixels[pix.x + pix.y*width] = pix.color;
            }
        }

        Ok(Canvas {
            width,
            height,
            pixels,
        })
    }

    fn get_palette(&self) -> Result<Palette, ()> {
        let mut pal = HashMap::new();
        pal.insert(0, Color(250, 250, 250));// white
        pal.insert(1, Color(255, 51, 51));  // red
        pal.insert(2, Color(51, 255, 51));  // green
        pal.insert(3, Color(51, 51, 255));  // blue
        pal.insert(4, Color(255, 51, 255)); // magenta
        pal.insert(5, Color(51, 255, 255)); // cyan
        pal.insert(6, Color(255, 255, 51)); // yellow
        pal.insert(7, Color(10, 10, 10));   // black
        pal.insert(8, Color(70, 70, 70));   // gray
        pal.insert(9, Color(130, 130, 130));   // light-gray
        pal.insert(10, Color(60, 180, 75));   // dark-green
        pal.insert(11, Color(170, 255, 195));   // mint
        pal.insert(12, Color(128, 0, 0));   // maroon
        pal.insert(13, Color(250, 190, 212));   // pink
        pal.insert(14, Color(0, 0, 128));   // navy
        pal.insert(15, Color(100, 130, 200));   // lightblue
        pal.insert(16, Color(145, 30, 180));   // purple
        pal.insert(17, Color(220, 190, 255));   // lavender
        pal.insert(18, Color(128, 128, 0));   // olive
        pal.insert(19, Color(255, 250, 200));   // beige
        pal.insert(20, Color(245, 130, 48));   // orange
        pal.insert(21, Color(150, 90, 20));   // brown
        pal.insert(22, Color(255, 215, 180));   // apricot
        pal.insert(23, Color(0, 128, 128));   // teal
        Ok(Palette { count: pal.len(), colors: pal, order: vec![0, 9, 8, 7, 13, 1, 12, 11, 2, 10, 15, 3, 14, 17, 4, 16, 5, 23, 19, 6, 18, 21, 20, 22] })
    }

    fn get_users_rank(&self, count: usize) -> rusqlite::Result<HashMap<String, usize>> {
        let mut result = HashMap::new();

        let count = if count <= 30 {count} else {30};

        let mut stmt = self.conn.prepare("SELECT owner, COUNT(owner) FROM pixels WHERE owner != 0 AND owner != 'User' GROUP BY owner ORDER BY COUNT(owner) DESC LIMIT ?")?;
        let mut r = stmt.query([count])?;
        while let Some(row) = r.next()? {
            result.insert(row.get(0)?, row.get(1)?);
        }

        Ok(result)
    }

    fn get_party_rank(&self, count: usize) -> rusqlite::Result<HashMap<String, usize>> {
        let mut result = HashMap::new();

        let count = if count <= 30 {count} else {30};

        let mut stmt = self.conn.prepare("SELECT party, COUNT(party) FROM pixels WHERE party != 0 AND party != 'NoParty' GROUP BY party ORDER BY COUNT(party) DESC LIMIT ?")?;
        let mut r = stmt.query([count])?;
        while let Some(row) = r.next()? {
            result.insert(row.get(0)?, row.get(1)?);
        }

        Ok(result)
    }

    fn get_party_list(&self) -> rusqlite::Result<Vec<String>> {
        let mut result = Vec::new();

        let mut stmt = self.conn.prepare("SELECT party FROM pixels WHERE party != 0 GROUP BY party")?;
        let mut r = stmt.query([])?;

        while let Some(row) = r.next()? {
            result.push(row.get(0)?);
        }

        Ok(result)
    }

    fn put_pixel(&mut self, event: PutPixelEvent) -> rusqlite::Result<()> {
        let width = self.canvas_width;
        let height = self.canvas_height;

        if event.x < width && event.y < height && event.color != self.get_pixel(event.x, event.y)? {
            let time: usize = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or(std::time::Duration::ZERO)
                .as_millis() as usize;
            self.conn.execute("INSERT INTO pixels (x, y, color, owner, party) SELECT ?1, ?2, ?3, ?4, ?5 WHERE NOT EXISTS (SELECT (x, y) FROM pixels WHERE x=?1 AND y=?2);", [event.x, event.y, 0, 0, 0])?;
            self.conn.execute("INSERT INTO events (time, x, y, color, owner, party) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", (time, event.x, event.y, event.color, event.user.clone(), event.party.clone()))?;
            self.conn.execute("UPDATE pixels SET x=?1, y=?2, color=?3, owner=?4, party=?5 WHERE x=?1 AND y=?2", (event.x, event.y, event.color, event.user, event.party))?;
            self.update_history_height()?;
        }
        Ok(())
    }

    fn get_pixel(&mut self, x: usize, y: usize) -> rusqlite::Result<u8> {
        let mut stmt = self.conn.prepare("SELECT color FROM pixels WHERE x=?1 AND y=?2")?;
        let mut c = stmt.query([x, y])?;
        let color = if let Some(row) = c.next()? {
            row.get(0)?
        } else {
            0
        };
        Ok(color)
    }

    fn get_pixel_owner(&mut self, x: usize, y: usize) -> rusqlite::Result<String> {
        let mut stmt = self.conn.prepare("SELECT owner FROM pixels WHERE x=?1 AND y=?2 AND NOT owner IS NULL AND owner != 0")?;
        let mut c = stmt.query([x, y])?;
        let owner = if let Some(row) = c.next()? {
            row.get(0)?
        } else {
            String::from("User")
        };
        Ok(owner)
    }

    fn get_pixel_party(&mut self, x: usize, y: usize) -> rusqlite::Result<String> {
        let mut stmt = self.conn.prepare("SELECT party FROM pixels WHERE x=?1 AND y=?2 AND NOT party IS NULL AND party != 0")?;
        let mut c = stmt.query([x, y])?;
        let owner = if let Some(row) = c.next()? {
            row.get(0)?
        } else {
            String::from("NoParty")
        };
        Ok(owner)
    }

    fn update_history_height(&mut self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("SELECT MAX(id) FROM events")?;
        let mut h = stmt.query([])?;
        let height = if let Some(row) = h.next()? {
            row.get(0)?
        } else {
            1
        };
        self.history_height = height;
        Ok(())
    }

    fn get_events(&self, from: usize) -> rusqlite::Result<Vec<OutputPixelEvent>> {
        let mut stmt = self.conn.prepare("SELECT id, x, y, color FROM events WHERE id > ? ORDER BY id ASC")?;
        let result = stmt.query_map([from], |row| Ok(OutputPixelEvent {
            id: row.get(0)?,
            x: row.get(1)?,
            y: row.get(2)?,
            color: row.get(3)?,
            width: self.canvas_width,
            height: self.canvas_height,
        }))?.map(|x| x.unwrap()).collect();
        Ok(result)
    }

    fn put_user_info(&self, name: &str, ip: &str, agent: &str) -> rusqlite::Result<()> {
        self.conn.execute("INSERT INTO user_data (name, ip, agent) SELECT ?1, ?2, ?3 WHERE NOT EXISTS (SELECT (ip, agent) FROM user_data WHERE ip=?2 AND agent=?3);", [name, ip, agent])?;
        Ok(())
    }

    fn get_user_info(&self, name: &str) -> rusqlite::Result<(String, String)> {
        let mut stmt = self.conn.prepare("SELECT ip, agent FROM user_data WHERE name=?1 AND NOT ip IS NULL AND NOT agent IS NULL")?;
        let mut c = stmt.query([name])?;
        let data = if let Some(row) = c.next()? {
            (
                row.get(0)?,
                row.get(1)?,
            )
        } else {
            (
                String::from("NaN"),
                String::from("NaN"),
            )
        };
        Ok(data)
    }
}

struct ServerState {
    db: Mutex<Db>,
    admin_key: String,
}

async fn get_canvas(state: web::Data<ServerState>) -> actix_web::Result<impl Responder> {
    let canvas: Canvas = if let Ok(a) = state.db.lock().unwrap().get_canvas() {
        a
    } else {
        return Ok(HttpResponse::NoContent().finish())
    };
    Ok(HttpResponse::Ok().json(canvas))
}

async fn get_palette(state: web::Data<ServerState>) -> actix_web::Result<impl Responder> {
    let palette: Palette = if let Ok(a) = state.db.lock().unwrap().get_palette() {
        a
    } else {
        return Ok(HttpResponse::NotFound().finish())
    };
    Ok(HttpResponse::Ok().json(palette))
}

async fn get_history_height(state: web::Data<ServerState>) -> actix_web::Result<impl Responder> {
    let height = state.db.lock().unwrap().history_height;
    Ok(HttpResponse::Ok().json(height))
}

#[get("/api/get_events/{from}")]
async fn get_events(query: web::Path<usize>, state: web::Data<ServerState>) -> actix_web::Result<impl Responder> {
    let events = if let Ok(a) = state.db.lock().unwrap().get_events(query.into_inner()) {
        a
    } else {
        return Ok(HttpResponse::NotFound().finish())
    };
    Ok(HttpResponse::Ok().json(events))
}

#[get("/api/get_users_rank/{count}")]
async fn get_users_rank(query: web::Path<usize>, state: web::Data<ServerState>) -> actix_web::Result<impl Responder> {
    let rank = if let Ok(a) = state.db.lock().unwrap().get_users_rank(query.into_inner()) {
        a
    } else {
        return Ok(HttpResponse::NotFound().finish())
    };
    Ok(HttpResponse::Ok().json(rank))
}

#[get("/api/get_party_rank/{count}")]
async fn get_party_rank(query: web::Path<usize>, state: web::Data<ServerState>) -> actix_web::Result<impl Responder> {
    let rank = match state.db.lock().unwrap().get_party_rank(query.into_inner()) {
        Ok(a) => a,
        Err(e) => return Ok(HttpResponse::NotFound().body(format!("Can't get party rank: {}", e.to_string()))),
    };
    Ok(HttpResponse::Ok().json(rank))
}

async fn get_party_list(state: web::Data<ServerState>) -> actix_web::Result<impl Responder> {
    let list = match state.db.lock().unwrap().get_party_list() {
        Ok(a) => a,
        Err(e) => return Ok(HttpResponse::NotFound().body(format!("Can't get party list: {}", e.to_string()))),
    };
    Ok(HttpResponse::Ok().json(list))
}

#[get("/api/get_pixel_owner/{x}/{y}")]
async fn get_pixel_owner(query: web::Path<(usize, usize)>, state: web::Data<ServerState>) -> actix_web::Result<impl Responder> {
    let (x, y) = query.into_inner();
    let owner = match state.db.lock().unwrap().get_pixel_owner(x, y) {
        Ok(a) => a,
        Err(e) => return Ok(HttpResponse::NotFound().body(format!("Can't get pixel's owner {}", e.to_string()))),
    };
    Ok(HttpResponse::Ok().json(owner))
}

#[get("/api/get_pixel_party/{x}/{y}")]
async fn get_pixel_party(query: web::Path<(usize, usize)>, state: web::Data<ServerState>) -> actix_web::Result<impl Responder> {
    let (x, y) = query.into_inner();
    let owner = match state.db.lock().unwrap().get_pixel_party(x, y) {
        Ok(a) => a,
        Err(e) => return Ok(HttpResponse::NotFound().body(format!("Can't get pixel's party {}", e.to_string()))),
    };
    Ok(HttpResponse::Ok().json(owner))
}

fn match_name(name: &str) -> bool {
    for ch in name.to_lowercase().chars() {
        if !(ch.is_alphanumeric() || ch.is_whitespace() || ch == '.' || ch == '_') {
            return false;
        }
    }
    return true;
} 

async fn put_pixel(req: HttpRequest, query: web::Json<PutPixelEvent>, state: web::Data<ServerState>) -> actix_web::Result<impl Responder> {
    debug!("/api/put_pixel request");
    let event = query.into_inner();
    if !(match_name(&event.user) && match_name(&event.party) && event.user.chars().count() <= 24 && event.party.chars().count() <= 24) {
        return Ok(HttpResponse::BadRequest().body("Invalid username or party"));
    }
    let mut guard = state.db.lock().unwrap();
    if let Err(_) = guard.put_pixel(event.clone()) {
        Ok(HttpResponse::NotModified().body("Error occurse while putting pixel"))
    } else {
        let ip = if let Some(a) = req.headers().get("x-forwarded-host") {
            a.to_str().unwrap_or("NaN")
        } else {
            "NaN"
        };
        let agent = if let Some(a) = req.headers().get("user-agent") {
            a.to_str().unwrap_or("NaN")
        } else {
            "NaN"
        };
        guard.put_user_info(
            &event.user,
            ip,
            agent);
        Ok(HttpResponse::Ok().finish())
    }
}

#[get("/api/get_user_info/{key}/{name}")]
async fn get_user_info(query: web::Path<(String, String)>, state: web::Data<ServerState>) -> actix_web::Result<impl Responder> {
    let (key, name) = query.into_inner();
    if key.trim().eq(&state.admin_key) {
        let owner = match state.db.lock().unwrap().get_user_info(&name) {
            Ok(a) => a,
            Err(e) => return Ok(HttpResponse::NotFound().body(format!("Can't get user's data {}", e.to_string()))),
        };
        return Ok(HttpResponse::Ok().json(owner));
    }
    Ok(HttpResponse::NotFound().finish())
}

async fn play_page() -> impl Responder {
    NamedFile::open_async("./static/play.html").await
}

async fn view_page() -> impl Responder {
    NamedFile::open_async("./static/view.html").await
}

async fn tutorial_page() -> impl Responder {
    NamedFile::open_async("./static/tutorial.html").await
}

#[get("/inspect/{key}")]
async fn inspect_page(query: web::Path<String>, state: web::Data<ServerState>) -> impl Responder {
    if query.into_inner().trim().eq(&state.admin_key) {
        NamedFile::open_async("./static/inspect.html").await
    } else {
        NamedFile::open_async("./static/play.html").await
    }
}

#[derive(Parser, Debug)]
struct CliArgs {
    #[arg(long, default_value="./db.db")]
    db: PathBuf,

    #[arg(short, long, default_value="8080")]
    port: u16,

    #[arg(short, long, default_value="127.0.0.1")]
    addr: String,

    #[arg(long, default_value="aboba")]
    admin_key: String,

    #[arg(long, default_value="100")]
    width: usize,

    #[arg(long, default_value="100")]
    height: usize,

    #[arg(long, default_value="10")]
    cooldown: usize,

    #[arg(long)]
    reinit: bool,
}

#[actix_web::main]
async fn main() -> std::io::Result<()>{
    env_logger::init();

    let args = CliArgs::parse();
    let path = args.db;
    // let exists = path.exists();
    let conn = Connection::open(&path).expect("Can't connect to database");
    let db = match Db::new(conn, args.width, args.height, args.cooldown, args.reinit) {
        Ok(db) => db,
        Err(e) => {
            println!("Can't initialize db: {e}");
            return Ok(());
        }
    };
    let state = web::Data::new(ServerState {
        db: Mutex::new(db),
        admin_key: args.admin_key,
    });
    let governor_conf = GovernorConfigBuilder::default()
        .per_millisecond(5)
        .burst_size(500)
        .finish()
        .unwrap();
    println!("Starting server");
    HttpServer::new(move || {
        App::new()
            .wrap(middleware::Compress::default())
            .app_data(state.clone())
            .service(
                Files::new("/static", "./static")
            )
            .wrap(Governor::new(&governor_conf))
            .service(get_events)
            .service(get_users_rank)
            .service(get_party_rank)
            .service(get_pixel_owner)
            .service(get_pixel_party)
            .service(get_user_info)
            .service(
                web::scope("/api")
                    .route("/get_canvas", web::get().to(get_canvas))
                    .route("/get_palette", web::get().to(get_palette))
                    .route("/get_palette", web::get().to(get_palette))
                    .route("/get_history_height", web::get().to(get_history_height))
                    .route("/get_party_list", web::get().to(get_party_list))
                    .route("/put_pixel", web::put().to(put_pixel))
            )
            .service(inspect_page)
            .service(
                web::scope("")
                    .route("/play", web::get().to(play_page))
                    .route("/view", web::get().to(view_page))
                    .route("/", web::get().to(tutorial_page))
            )
    })
    .bind((args.addr, args.port))?
    .run()
    .await
}
