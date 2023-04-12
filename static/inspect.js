// TODO: better ui
// TODO: hide placeholder after pixel placing

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
    updated_pixels: [],
    full_render: true,
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
//   2 - change party
let screen = 0; 

// User identity
let username = "User";
let party = 'NoParty';

let party_list = [];

// Zoom gestures
let evStack = [];
let prev = -1;
let zoomSpeed = 0.001;

// Canvas and cursor movement
let dragging = false;
let cursor_view = false;
let cursor_pos = [0, 0];
let drag_offset = [0, 0];
let dragging_started = "";

let pix_owner = "";
let pix_party = "";
let pix_agent = "";
let pix_ip = "";

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { alpha: false });
const cnv_scr = document.getElementById("canvas_scroll");
const selector = document.getElementById("selector");
const placeholder = document.getElementById("placeholder");

const error = async (text) => {
    const cont = document.createElement("div");
    cont.classList = ["error_el"];

    const label = document.createElement("span");
    label.innerText = text;
    cont.appendChild(label);
    const list = document.getElementById("error_list");
    list.appendChild(cont);
    setTimeout(() => updatePalette().then(() => list.removeChild(cont)), 1000);
}

const updateField = async () => {
    fetch("/api/get_canvas").then((resp) => {
        if (resp.status == 200) {
            resp.json().then((json) => {
                if (json != null) {
                    field.pixels = json.pixels;
                    field.width = json.width;
                    field.height = json.height;
                } else {
                    error("Can't update field");
                }
            })
        } else {
            error("Can't update field");
        }
    }).catch(error)
    field.full_render = true;
    updateHistoryHeight();
}

const updateHistoryHeight = async () => {
    fetch("/api/get_history_height").then((resp) => {
        if (resp.status == 200) {
            resp.json().then((json) => {
                if (json != null) {
                    field.history_height = json;
                }
            })
        }
    })
}

const updatePartyList = async () => {
    fetch("/api/get_party_list").then((resp) => {
        if (resp.status == 200) {
            resp.json().then((json) => {
                party_list = json;
                party_list.sort();
            })
        } else {
            error(resp.body)
        }
    });
}

const getPixelOwner = async (x, y) => {
    fetch(`/api/get_pixel_owner/${x}/${y}`).then((resp) => {
        if (resp.status == 200) {
            resp.json().then((json) => {
                pix_owner = json;
            })
        } else {
            pix_owner = "User";
        }
    });
}

const getUserInfo = async (key, name) => {
    fetch(`/api/get_user_info/${key}/${name}`).then((resp) => {
        if (resp.status == 200) {
            resp.json().then((json) => {
                pix_ip = json[0];
                pix_agent = json[1];
            })
        } else {
            pix_ip = "Nan";
            pix_agent = "NaN"
        }
    });
}

const getPixelParty = async (x, y) => {
    fetch(`/api/get_pixel_party/${x}/${y}`).then((resp) => {
        if (resp.status == 200) {
            resp.json().then((json) => {
                pix_party = json;
            })
        } else {
            pix_party = "NoParty";
        }
    });
}

const updateFieldDelta = async () => {
    fetch(`/api/get_events/${field.history_height}`).then((resp) => {
        if (resp.status == 200) {
            resp.json().then((json) => {
                if (json != null) {
                    field.full_render = false;
                    const ss = (a, b) => a.history_height - b.history_height;
                    json.sort(ss);
                    for (let i = 0; i < json.length; i++) {
                        const ev = json[i];
                        if (ev.id < field.history_height || ev.width != field.width || ev.height != field.height) {
                            updateField();
                            field.full_render = true;
                        } else {
                            if (ev.x < ev.width && ev.y < ev.height) {
                                field.pixels[ev.x + ev.y*field.width] = ev.color;
                                field.updated_pixels.push([ev.x, ev.y]);
                            }
                            field.history_height = Math.max(field.history_height, ev.id);
                        }
                    }
                }
            })
        } else {
            error("Can't update field");
        }
    })
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
;
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
            party: party,
        })
    });
    if (resp.status != 200) {
        error(`Error put pixel`);
    }
};

// Update canvas image by field.pixels buffer
const renderCanvas = () => {
    if (canvas != null) {
        if (field.full_render) {
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
        } else {
            for (let j = 0; j < field.updated_pixels.length; j++) {
                const i = field.updated_pixels[j];
                const index = field.pixels[i[0] + i[1]*field.width];
                let color = "#222";
                if (index < palette.count) {
                    color = rgbToHex(palette.colors[index]);
                }
                ctx.fillStyle = color;
                ctx.fillRect(i[0], i[1], 1, 1);
            }
            field.updated_pixels = [];
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
    cnv_cnt.onpointercancel = (e) => {
        if (screen == 0) {
            removeEvent(e);
            if (evStack.length < 2) {
                prev = -1;
            }
        }
    }
    cnv_cnt.onpointerleave = (e) => {
        if (screen == 0) {
            removeEvent(e);
            if (evStack.length < 2) {
                prev = -1;
            }
        }
    }
    cnv_cnt.onpointerup = (e) => {
        if (screen == 0) {
            const time = new Date() - dragging_started;
            if (time < field.click_duration) {
                const x = Math.floor(Math.floor((e.clientX - field.offset[0] - cnv_cnt.offsetLeft) / field.scale));
                const y = Math.floor(Math.floor((e.clientY - field.offset[1] - cnv_cnt.offsetTop) / field.scale));
                if (x >= 0 && x < field.width && y >= 0 && y < field.height)
                    if (e.pointerType == "mouse" && e.button == 0 || e.pointerType == "touch") {
                        cursor_pos = [x, y];
                        getPixelParty(x, y).then((_) => {
                            getPixelOwner(x, y).then((_) => {
                                getUserInfo(document.getElementById("key").value, pix_owner).then((_) => {
                                    document.getElementById("coord").innerText = `Coords: ${cursor_pos[0]+1} : ${cursor_pos[1]+1} | Owner: ${pix_owner} | Party: ${pix_party} | IP: ${pix_ip} | Agent: ${pix_agent}`;
                                })
                            })
                        })
                        // getPixelOwner(x, y).then(() => getPixelParty(x, y).then(() => document.getElementById("coord").innerText = `Coords: ${cursor_pos[0]+1} : ${cursor_pos[1]+1} - ${pix_owner} | ${pix_party}`));
                        updatePlaceholderTransform();
                    }
            }
            removeEvent(e);
            if (evStack.length < 2) {
                prev = -1;
            }

            if (evStack.length == 1) {
                drag_offset[0] = evStack[0].clientX;
                drag_offset[1] = evStack[0].clientY;
            }
            dragging = false;
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
                const distance = Math.sqrt(Math.pow(evStack[0].clientX-evStack[1].clientX, 2) + Math.pow(evStack[0].clientY-evStack[1].clientY, 2));   
                if (prev > 0 && prev - distance != 0) {
                    const dp = distance - prev;
                    let delta = dp / 2;
                    // if (dp < 0) {
                    //     delta = -delta;
                    // }
                    // document.getElementById("stat").innerText = delta;
                    let ns = field.scale;
                    if (Math.abs(delta) > 1) {
                        ns = Math.min(field.max_scale, Math.max(field.min_scale, Math.floor(field.scale+delta)));
                    }

                    if (ns != field.scale) {
                        // const mx = e.clientX - field.offset[0];
                        // const my = e.clientY - field.offset[1] - cnv_cnt.offsetTop 
                        const mx = cnv_cnt.offsetWidth/2 - field.offset[0];
                        const my = cnv_cnt.offsetHeight/2 - field.offset[1] - cnv_cnt.offsetTop 
                        const nsx = field.width*ns;
                        const nsy = field.height*ns;
                        const sx = field.width*field.scale;
                        const sy = field.height*field.scale;
                        field.offset[0] -= (nsx - sx) * mx/sx;
                        field.offset[1] -= (nsy - sy) * my/sy;

                        field.scale = ns;
                        updateCanvasTransform();
                        updatePlaceholderTransform();
                        updateSelectorTransform([e.clientX, e.clientY]);
                    }
                }
                prev = distance;
            } else if (evStack.length == 1) {
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
            const ns = Math.min(field.max_scale, Math.max(field.min_scale, field.scale+delta));
            if (ns != field.scale) {
                const mx = e.clientX - field.offset[0];
                const my = e.clientY - field.offset[1] - cnv_cnt.offsetTop 
                const nsx = field.width*(field.scale + delta);
                const nsy = field.height*(field.scale + delta);
                const sx = field.width*field.scale;
                const sy = field.height*field.scale;
                field.offset[0] -= (nsx - sx) * mx/sx;
                field.offset[1] -= (nsy - sy) * my/sy;
                field.scale = ns;
                updateCanvasTransform();
                updatePlaceholderTransform();
                updateSelectorTransform([e.clientX, e.clientY]);
            } 
        }
    }
}

document.getElementById("plus_scale").onclick = () => {
    const delta = 2;
    const ns = Math.min(field.max_scale, Math.max(field.min_scale, Math.floor(field.scale+delta)));
    if (ns != field.scale) {
        const mx = cnv_cnt.offsetWidth/2 - field.offset[0];
        const my = cnv_cnt.offsetHeight/2 - field.offset[1] - cnv_cnt.offsetTop 
        const nsx = field.width*ns;
        const nsy = field.height*ns;
        const sx = field.width*field.scale;
        const sy = field.height*field.scale;
        field.offset[0] -= (nsx - sx) * mx/sx;
        field.offset[1] -= (nsy - sy) * my/sy;

        field.scale = ns;
        updateCanvasTransform();
        updatePlaceholderTransform();
    }
};

document.getElementById("minus_scale").onclick = () => {
    const delta = -2;
    const ns = Math.min(field.max_scale, Math.max(field.min_scale, Math.floor(field.scale+delta)));
    if (ns != field.scale) {
        const mx = cnv_cnt.offsetWidth/2 - field.offset[0];
        const my = cnv_cnt.offsetHeight/2 - field.offset[1] - cnv_cnt.offsetTop 
        const nsx = field.width*ns;
        const nsy = field.height*ns;
        const sx = field.width*field.scale;
        const sy = field.height*field.scale;
        field.offset[0] -= (nsx - sx) * mx/sx;
        field.offset[1] -= (nsy - sy) * my/sy;

        field.scale = ns;
        updateCanvasTransform();
        updatePlaceholderTransform();
    }
};

renderCanvas();
updatePalette();
updateSelectorTransform([0, 0]);
updateField().then(() => {
    // const min_size = Math.floor(Math.min(cnv_cnt.offsetWidth / field.width, cnv_cnt.offsetHeight / field.height));
    // // console.log(min_size);
    // field.scale = min_size;
    field.offset[0] = cnv_cnt.offsetWidth / 2 - field.width*field.scale / 2;
    field.offset[1] = cnv_cnt.offsetHeight / 2 - field.height*field.scale / 2;
    updateCanvasTransform();
    renderCanvas();
    updatePlaceholderTransform();
});


// Synchronize canvastrueevery 1 second
setInterval(async () => updateFieldDelta().then(() => {
    updateCanvasTransform();
    renderCanvas();
    cursor_pos[0] = Math.min(field.width, cursor_pos[0]);
    cursor_pos[1] = Math.min(field.height, cursor_pos[1]);
    updatePlaceholderTransform();
}), 1000);
