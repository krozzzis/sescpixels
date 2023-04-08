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

let usersRank = {};
let partyRank = {};

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { alpha: false });
const cnv_scr = document.getElementById("canvas_scroll");
const cnv_cnt = document.getElementById("canvas_container");

const getUserId = async (un) => {
    const resp = await fetch(`/api/get_id/${un}`);
    if (resp.status == 200) {
        console.log(resp)
    }
}

const updateField = async () => {
    fetch("/api/get_canvas").then((resp) => {
        if (resp.status == 200) {
            resp.json().then((json) => {
                if (json != null) {
                    field.pixels = json.pixels;
                    field.width = json.width;
                    field.height = json.height;
                }
            })
        }
    });
    field.full_render = true;
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

const updateUsersRank = async () => {
    const resp = await fetch("/api/get_users_rank/7");
    if (resp.status == 200) {
        const json = await resp.json();
        if (json != null) {
            usersRank = json;
        }
    }
}
const updatePartyRank = async () => {
    const resp = await fetch("/api/get_party_rank/7");
    if (resp.status == 200) {
        const json = await resp.json();
        if (json != null) {
            partyRank = json;
        }
    }
}

const updateFieldDelta = async () => {
    fetch(`/api/get_events/${field.history_height}`).then((resp) => {
        if (resp.status == 200) {
            resp.json().then((json) => {
                if (json != null) {
                    field.full_render = false;
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

const updateUsersRankEl = () => {
    const rank_el = document.getElementById("users_rank");

    while (rank_el.lastChild) 
        rank_el.removeChild(rank_el.lastChild);

    let row = document.createElement("tr");
    row.classList.add("table_title");

    let a = document.createElement("th");
    a.innerText = "Пользователь";
    row.appendChild(a);

    let b = document.createElement("th");
    b.innerText = "Счет";
    row.appendChild(b);

    rank_el.appendChild(row);

    let items = Object.keys(usersRank).map(
        (key) => { return [key, usersRank[key]] });

    items.sort(
        (a, b) => { return b[0].localeCompare(a[0]) }
    );

    items.sort(
        (first, second) => { return second[1] - first[1] }
    );

    for (let i = 0; i < items.length; i++) {
        const name = items[i][0];
        const score = items[i][1];
        const row = document.createElement("tr");

        const name_el = document.createElement("th");
        name_el.innerText = name;
        row.appendChild(name_el);

        const score_el = document.createElement("th");
        score_el.innerText = score;
        row.appendChild(score_el);

        rank_el.appendChild(row);
    }
}

const updatePartyRankEl = () => {
    const rank_el = document.getElementById("party_rank");

    while (rank_el.lastChild) 
        rank_el.removeChild(rank_el.lastChild);

    let row = document.createElement("tr");
    row.classList.add("table_title");

    let a = document.createElement("th");
    a.innerText = "Партия";
    row.appendChild(a);

    let b = document.createElement("th");
    b.innerText = "Счет";
    row.appendChild(b);

    rank_el.appendChild(row);

    let items = Object.keys(partyRank).map(
        (key) => { return [key, partyRank[key]] });

    items.sort(
        (a, b) => { return b[0].localeCompare(a[0]) }
    );

    items.sort(
        (first, second) => { return second[1] - first[1] }
    );

    for (let i = 0; i < items.length; i++) {
        const name = items[i][0];
        const score = items[i][1];
        const row = document.createElement("tr");

        const name_el = document.createElement("th");
        name_el.innerText = name;
        row.appendChild(name_el);

        const score_el = document.createElement("th");
        score_el.innerText = score;
        row.appendChild(score_el);

        rank_el.appendChild(row);
    }
}

const rgbToHex = (color) => {
    return "#" + (1 << 24 | color[0] << 16 | color[1] << 8 | color[2]).toString(16).slice(1);
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
    const min_size = Math.floor(Math.max(1, Math.min(cnv_cnt.offsetWidth / field.width, cnv_cnt.offsetHeight / field.height)));
    field.scale = min_size;
    field.offset[0] = cnv_cnt.offsetWidth / 2 - field.width*field.scale / 2;
    field.offset[1] = cnv_cnt.offsetHeight / 2 - field.height*field.scale / 2;
    cnv_scr.style.transform = `translate(${field.offset[0]}px, ${field.offset[1]}px) scale(${field.scale})`;
}


function removeEvent(ev) {
    // Remove this event from the target's cache
    const index = evStack.findIndex(
        (cachedEv) => cachedEv.pointerId === ev.pointerId
    );
    evStack.splice(index, 1);
}


window.onresize = updateCanvasTransform;

document.getElementById("url").innerText = `${window.location.hostname}/play`;
document.getElementById("url").href = `${window.location.protocol}//${window.location.hostname}/play`;

renderCanvas();
updatePalette();
// updatePlaceholderTransform();
// updateSelectorTransform([0, 0]);
updateField().then(() => {
    updateCanvasTransform();
    renderCanvas();
});

updateUsersRank().then(() => updateUsersRankEl());
updatePartyRank().then(() => updatePartyRankEl());

// Synchronize canvas every 1 second
setInterval(() => updateFieldDelta().then(() => {
    renderCanvas();
    updateCanvasTransform();
    updateUsersRank().then(() => updateUsersRankEl());
    updatePartyRank().then(() => updatePartyRankEl());
    // cursor_pos[0] = Math.min(field.width, cursor_pos[0]);
    // cursor_pos[1] = Math.min(field.height, cursor_pos[1]);
    // updatePlaceholderTransform();
}), 1000);

// Update palette every 20 seconds
setInterval(() => updatePalette(), 20000);
