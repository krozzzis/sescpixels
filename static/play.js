// TODO: better zoom handling on pc
// TODO: zoom with touch gestures
// TODO: better ui
// TODO: hide placeholder after pixel placing
// TODO: show error messages on the screen

let field = {
    pixels: [0],
    width: 1,
    height: 1,
    scale: 5,
    min_scale: 1,
    max_scale: 160,
    click_duration: 300,
    offset: [0, 0],
    history_height: 1,
};

let palette = {
    count: 1,
    order: [0],
    colors: {
        0: [255, 255, 255],
    },
};
let selected_color = 0;

// Screens:
//   0 - default
//   1 - change username
let screen = 0; 

// Username
let username = "User";

// Zoom gestures
let evStack = [];
let zoomDiff = -1;
let zoomSpeed = 0.001;

// Canvas and cursor movement
let dragging = false;
let cursor_view = false;
let cursor_pos = [0, 0];
let drag_offset = [0, 0];
let dragging_started = "";

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { alpha: false });
const cnv_scr = document.getElementById("canvas_scroll");
const selector = document.getElementById("selector");
const placeholder = document.getElementById("placeholder");

const getUserId = async (un) => {
    const resp = await fetch(`/api/get_id/${un}`);
    if (resp.status == 200) {
        console.log(resp)
    }
}

const updateField = async () => {
    const resp = await fetch("/api/get_canvas");
    if (resp.status == 200) {
        const json = await resp.json();
        if (json != null) {
            field.pixels = json.pixels;
            field.width = json.width;
            field.height = json.height;
        }
    }
    updateHistoryHeight();
}

const updateHistoryHeight = async () => {
    const resp = await fetch("/api/get_history_height");
    if (resp.status == 200) {
        const json = await resp.json();
        if (json != null) {
            field.history_height = json;
        }
    }
}

const updateFieldDelta = async () => {
    const resp = await fetch(`/api/get_events/${field.history_height}`);
    if (resp.status == 200) {
        const json = await resp.json();
        if (json != null) {
            // console.log(json);
            for (let i = 0; i < json.length; i++) {
                const ev = json[i];
                if (ev.width != field.width || ev.height != field.height) {
                    updateField();
                } else {
                    field.pixels[ev.x + ev.y*field.width] = ev.color;
                }
            }
        }
        updateHistoryHeight();
    } else {
        console.log("can't update field by delta");
    }
}

const updatePalette = async () => {
    const resp = await fetch("/api/get_palette");
    if (resp.status == 200) {
        const json = await resp.json();
        if (json != null) {
            palette.colors = json.colors;
            palette.order = json.order;
            palette.count = json.count;
        }
    }
}

const rgbToHex = (color) => {
    return "#" + (1 << 24 | color[0] << 16 | color[1] << 8 | color[2]).toString(16).slice(1);
}

// Create/remove/update elements in palette element on the screen
const updatePaletteElement = () => {
    const palette_el = document.getElementById("palette");

    while (palette_el.lastChild) 
        palette_el.removeChild(palette_el.lastChild);

    for (let i in palette.order) {
        let index = palette.order[i];
        let color = document.createElement("button");
        color.id = `c_${index}`;
        color.classList = ["color"];
        color.style.backgroundColor = rgbToHex(palette.colors[index]);
        palette_el.appendChild(color);
        color.onclick = (_) => {
            if (screen == 0) {
                selected_color = index;
                updateSelectedColor();
                console.log("Changed color to " + index);
            }
        };
    }
}

const putPixel = async (pos, color) => {
    const resp = await fetch("/api/put_pixel", {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            x: pos[0],
            y: pos[1],
            color: color,
            user: username,
        })
    });
    if (resp.status != 200) {
        console.log("Error put pixel");
    }
};

// Update canvas image by field.pixels buffer
const renderCanvas = () => {
    if (canvas != null) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        canvas.width = field.width;
        canvas.height = field.height;
        for (let x = 0; x < field.width; x++) {
            for (let y = 0; y < field.height; y++) {
                const index = field.pixels[x + y*field.width];
                let color = "#222";
                if (index < palette.count) {
                    color = rgbToHex(palette.colors[index]);
                }
                ctx.fillStyle = color;
                ctx.fillRect(x, y, 1, 1);
            }
        }
    }
}

// Translate canvas element on the screen with constainments
const updateCanvasTransform = () => {
    const padding = 80;
    field.offset[0] = Math.min(window.innerWidth - padding, Math.max(padding-field.width*field.scale, field.offset[0]));
    field.offset[1] = Math.min(window.innerHeight - padding, Math.max(padding-field.height*field.scale, field.offset[1]));
    cnv_scr.style.transform = `translate(${field.offset[0]}px, ${field.offset[1]}px) scale(${field.scale})`;
}

const updatePlaceholderTransform = () => {
    placeholder.style.transform = `translate(${cursor_pos[0]*field.scale + field.offset[0]}px, ${cursor_pos[1]*field.scale + field.offset[1]}px)`;
    placeholder.style.width = `${field.scale}px`;
    placeholder.style.height = `${field.scale}px`;
};

const updateSelectorTransform = (pos) => {
    const x = Math.floor((pos[0] - field.offset[0] - cnv_cnt.offsetLeft) / field.scale);
    const y = Math.floor((pos[1] - field.offset[1] - cnv_cnt.offsetTop) / field.scale);
    selector.style.transform = `translate(${x*field.scale + field.offset[0]}px, ${y*field.scale + field.offset[1]}px)`;
    selector.style.width = `${field.scale}px`;
    selector.style.height = `${field.scale}px`;
}

function removeEvent(ev) {
    // Remove this event from the target's cache
    const index = evStack.findIndex(
        (cachedEv) => cachedEv.pointerId === ev.pointerId
    );
    evStack.splice(index, 1);
}

// Canvas movement and zoom
const cnv_cnt = document.getElementById("canvas_container");
if (cnv_cnt != null) {
    cnv_cnt.addEventListener("pointerdown", (e) => {
        if (screen == 0) {
            dragging = true;
            if (evStack.length == 0) {
                drag_offset[0] = e.clientX
                drag_offset[1] = e.clientY;
                dragging_started = new Date();
            }
            evStack.push(e);
        }
    }, false);
    cnv_cnt.onpointerup = (e) => {
        if (screen == 0) {
            removeEvent(e);
            if (evStack.length < 2) {
                zoomDiff = -1;
            }
            dragging = false;
            const time = new Date() - dragging_started;
            if (time < field.click_duration) {
                const x = Math.floor(Math.floor((e.clientX - field.offset[0] - cnv_cnt.offsetLeft) / field.scale));
                const y = Math.floor(Math.floor((e.clientY - field.offset[1] - cnv_cnt.offsetTop) / field.scale));
                if (x >= 0 && x < field.width && y >= 0 && y < field.height)
                    if (e.pointerType == "mouse" && e.button == 0 || e.pointerType == "touch") {
                        cursor_pos = [x, y];
                        updatePlaceholderTransform();
                    }
            }
        }
    }
    cnv_cnt.onpointermove = (e) => {
        if (screen == 0) {
            const index = evStack.findIndex(
                (cachedEv) => cachedEv.pointerId === e.pointerId
            );
            evStack[index] = e;
            if (e.pointerType == "mouse") {
                const x = Math.floor(Math.floor((e.clientX - field.offset[0] - cnv_cnt.offsetLeft) / field.scale));
                const y = Math.floor(Math.floor((e.clientY - field.offset[1] - cnv_cnt.offsetTop) / field.scale));
                // Cursor
                if (x >= 0 && y >= 0 && x < field.width && y < field.height) {
                    selector.style.display = "block";
                    updateSelectorTransform([e.clientX, e.clientY]);
                } else {
                    selector.style.display = "none";
                }
            } else {
                selector.style.display = "none";
            }

            // Zoom gesture
            if (evStack.length == 2) {
                const curDiff = Math.sqrt(Math.pow(2, evStack[0].clientX/100-evStack[1].clientX/100)/ +
                    Math.pow(2, evStack[0].clientY/100-evStack[1].clientY/100));   
                if (zoomDiff > 0) {
                    let delta = Math.floor(Math.pow(1.5, curDiff*0.02));
                    if (curDiff < zoomDiff)
                        delta = -delta;
                    document.getElementById("stat").innerText = Math.floor(delta);
                    field.scale -= delta;
                    field.scale = Math.min(field.max_scale, Math.max(field.min_scale, field.scale));
                    updateCanvasTransform();
                    updatePlaceholderTransform();
                    updateSelectorTransform([e.clientX, e.clientY]);
                }
                zoomDiff = curDiff;
            }
            if (dragging) {
                field.offset[0] += evStack[0].clientX - drag_offset[0];
                field.offset[1] += evStack[0].clientY - drag_offset[1];
                drag_offset[0] = evStack[0].clientX;
                drag_offset[1] = evStack[0].clientY;
                updateCanvasTransform();
                updatePlaceholderTransform();
            }
        }
    };
    cnv_cnt.onwheel = (e) => {
        if (screen == 0) {
            let speed = 0.01;
            let delta = Math.floor(Math.pow(2, Math.abs(e.wheelDelta*speed)));
            if (e.wheelDelta < 0)
                delta = -delta;
            // field.offset[0] -= Math.floor((field.width*(field.scale + delta) - field.width*field.scale) * (e.clientX - field.offset[0]) / (field.width*field.scale));
            // field.offset[1] -= Math.floor((field.height*(field.scale + delta) - field.height*field.scale) * (e.clientY - field.offset[1]) / (field.height*field.scale));
            const mx = e.clientX - field.offset[0];
            const my = e.clientY - field.offset[1];
            field.offset[0] -= mx/(field.scale + delta) - mx/field.scale;
            field.offset[1] -= my/(field.scale + delta) - my/field.scale;
            document.getElementById("stat").innerText = (Math.floor((field.width*field.scale - field.width*field.scale) * (e.clientX - field.offset[0]) / (field.width*field.scale)));
            field.scale += delta;
            field.scale = Math.min(field.max_scale, Math.max(field.min_scale, field.scale));
            updateCanvasTransform();
            updatePlaceholderTransform();
            updateSelectorTransform([e.clientX, e.clientY]);
        }
    }
}

// Move selection around selected color in the palette
const updateSelectedColor = () => {
    const colors = document.getElementsByClassName("color");
    for (let i = 0; i < colors.length; i++) {
        const color = colors[i];
        if (color.id.split("_")[1] == selected_color) {
            if (!color.classList.contains("selected_color")) 
                color.classList.add("selected_color");
        } else {
            if (color.classList.contains("selected_color")) 
                color.classList.remove("selected_color");
        }
    }
}

const changeScreens = () => {
    if (screen == 1) {
        document.getElementById("username_change_screen").style.display = "block";
    } else {
        document.getElementById("username_change_screen").style.display = "none";
    }
};

// Place pixel button
document.getElementById("place_pixel").onclick = () => {
    if (screen == 0) {
        putPixel(cursor_pos, selected_color).then(() => updateFieldDelta().then(() => {
            updateCanvasTransform();
            renderCanvas(); 
        }));
    }
};

document.getElementById("username_change").onclick = () => {
    screen = 1;
    document.getElementById("username_field").value = username;
    changeScreens();
};

document.getElementById("username_update").onclick = () => {
    const name = document.getElementById("username_field").value.trim();
    console.log(name);
    if (name.match("[a-zA-Zа-яА-Я0-9\s]{4,15}")) {
        screen = 0;
        username = name;
        localStorage.setItem("username", name);
        document.getElementById("username_change").innerText = name;
        changeScreens();
    } else {
        alert("Имя пользователя может содержать только буквы, цифры и пробелы. Длина - 4-15 символов.");
    }
};

document.getElementById("cancel_username_update").onclick = () => {
    screen = 0;
    changeScreens();
};

// Initial Synchronization
const nn = localStorage.getItem("username");
if (nn) {
    username = nn;
    document.getElementById("username_change").innerText = username;
}
renderCanvas();
updatePalette().then(() => {
    updatePaletteElement();
    updateSelectedColor();
});
updatePlaceholderTransform();
updateSelectorTransform([0, 0]);
updateField().then(() => {
    field.offset[0] = cnv_cnt.offsetWidth / 2 - field.width*field.scale / 2;
    field.offset[1] = cnv_cnt.offsetHeight / 2 - field.height*field.scale / 2;
    updateCanvasTransform();
    renderCanvas();
});

changeScreens();

// Synchronize canvas every 1 second
setInterval(() => updateFieldDelta().then(() => {
    updateCanvasTransform();
    renderCanvas();
    cursor_pos[0] = Math.min(field.width, cursor_pos[0]);
    cursor_pos[1] = Math.min(field.height, cursor_pos[1]);
    updatePlaceholderTransform();
}), 1000);

// Update palette every 10 seconds
setInterval(() => updatePalette().then(() => {
    updatePaletteElement();
    selected_color = Math.min(palette.count, selected_color);
    updateSelectedColor();
}), 10000);
