import * as THREE from "three";

function canvas(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function noise(g, w, h, alpha) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * alpha;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  g.putImageData(img, 0, 0);
}

function lambert(opts) {
  const mat = new THREE.MeshLambertMaterial(opts);
  return mat;
}

export function makeMaterials() {
  const brickTex = canvas(256, 256, (g, w, h) => {
    g.fillStyle = "#efe6dc";
    g.fillRect(0, 0, w, h);
    const bw = 32;
    const bh = 16;
    for (let row = 0; row < h / bh; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let x = -bw; x < w + bw; x += bw) {
        g.fillStyle = row % 3 === 0 ? "#f4eee6" : "#e7ddd0";
        g.fillRect(x + off + 1, row * bh + 1, bw - 2, bh - 2);
      }
    }
    noise(g, w, h, 18);
  });
  brickTex.repeat.set(1, 1);

  const sidingTex = canvas(128, 128, (g, w, h) => {
    g.fillStyle = "#f7f3ea";
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) {
      g.fillStyle = "rgba(60,40,20,0.18)";
      g.fillRect(0, y, w, 1);
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.fillRect(0, y + 1, w, 1);
    }
    noise(g, w, h, 12);
  });
  sidingTex.repeat.set(1, 1);

  const shingleTex = canvas(128, 128, (g, w, h) => {
    g.fillStyle = "#6e5a48";
    g.fillRect(0, 0, w, h);
    for (let row = 0; row < 8; row++) {
      const y = row * 16;
      const off = row % 2 ? 16 : 0;
      g.strokeStyle = "#3e3126";
      g.lineWidth = 2;
      for (let x = -32 + off; x < w + 32; x += 32) {
        g.strokeRect(x, y, 32, 16);
        g.fillStyle = row % 2 ? "#7a6552" : "#655445";
        g.fillRect(x + 1, y + 1, 30, 14);
      }
    }
    noise(g, w, h, 16);
  });
  shingleTex.repeat.set(1, 1);

  const plankTex = canvas(128, 128, (g, w, h) => {
    for (let x = 0; x < w; x += 16) {
      const shade = 150 + (x / 16) % 3 * 18;
      g.fillStyle = `rgb(${shade}, ${shade - 28}, ${shade - 55})`;
      g.fillRect(x, 0, 15, h);
      g.fillStyle = "rgba(40,24,10,0.45)";
      g.fillRect(x + 15, 0, 1, h);
    }
    noise(g, w, h, 14);
  });
  plankTex.repeat.set(1, 1);

  const dirtTex = canvas(256, 256, (g, w, h) => {
    g.fillStyle = "#8d7348";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) {
      g.fillStyle = Math.random() > 0.5 ? "rgba(70,50,24,0.25)" : "rgba(180,150,90,0.2)";
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 1 + Math.random() * 3);
    }
    g.strokeStyle = "rgba(70,48,22,0.35)";
    g.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.moveTo(0, 40 + i * 40);
      g.bezierCurveTo(80, 30 + i * 40, 160, 55 + i * 40, 256, 38 + i * 40);
      g.stroke();
    }
  });
  dirtTex.repeat.set(1, 1);

  const streetTex = canvas(256, 256, (g, w, h) => {
    g.fillStyle = "#7c623c";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2200; i++) {
      g.fillStyle = Math.random() > 0.5 ? "rgba(50,34,16,0.28)" : "rgba(160,130,75,0.18)";
      g.fillRect(Math.random() * w, Math.random() * h, 3, 2);
    }
    g.strokeStyle = "rgba(55,36,16,0.4)";
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(0, 90);
    g.bezierCurveTo(70, 70, 140, 120, 256, 86);
    g.moveTo(0, 170);
    g.bezierCurveTo(90, 150, 150, 190, 256, 160);
    g.stroke();
  });
  streetTex.repeat.set(1, 1);

  const grassTex = canvas(128, 128, (g, w, h) => {
    g.fillStyle = "#6f8a45";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      g.fillStyle = Math.random() > 0.5 ? "rgba(40,70,24,0.25)" : "rgba(180,190,90,0.2)";
      g.fillRect(Math.random() * w, Math.random() * h, 2, 3);
    }
  });
  grassTex.repeat.set(1, 1);

  const parkTex = canvas(128, 128, (g, w, h) => {
    g.fillStyle = "#5f8a3e";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = "rgba(30,80,20,0.2)";
      g.fillRect(Math.random() * w, Math.random() * h, 2, 4);
    }
  });
  parkTex.repeat.set(1, 1);

  const ballastTex = canvas(128, 128, (g, w, h) => {
    g.fillStyle = "#9a9288";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = Math.random() > 0.5 ? "#7e776e" : "#b7b0a4";
      g.fillRect(Math.random() * w, Math.random() * h, 3, 2);
    }
    g.fillStyle = "#6b5340";
    for (let y = 8; y < h; y += 18) g.fillRect(0, y, w, 5);
  });
  ballastTex.repeat.set(1, 1);

  const brick = (color) =>
    lambert({ map: brickTex, color });
  const siding = (color) =>
    lambert({ map: sidingTex, color });

  return {
    brick: {
      red: brick("#9a4034"),
      dark: brick("#7d332c"),
      soft: brick("#a85a3e"),
    },
    siding: {
      white: siding("#f4efe4"),
      cream: siding("#f0e2c4"),
      yellow: siding("#e6d48a"),
      gray: siding("#c9c2b6"),
      red: siding("#8d3a32"),
      green: siding("#7f8f72"),
      tan: siding("#d9c4a0"),
      darkred: siding("#6e2e2a"),
      depot: siding("#8d4d3a"),
    },
    roof: lambert({ map: shingleTex, color: "#8a7562" }),
    roofDark: lambert({ map: shingleTex, color: "#5c4a3c" }),
    plank: lambert({ map: plankTex, color: "#ffffff" }),
    dirt: lambert({ map: dirtTex, color: "#ffffff" }),
    street: lambert({ map: streetTex, color: "#ffffff" }),
    grass: lambert({ map: grassTex, color: "#ffffff" }),
    park: lambert({ map: parkTex, color: "#ffffff" }),
    ballast: lambert({ map: ballastTex, color: "#ffffff" }),
    trim: lambert({ color: "#f3ead7" }),
    trimDark: lambert({ color: "#4a3424" }),
    glass: lambert({ color: "#243038", emissive: "#3a2a18", emissiveIntensity: 0.35 }),
    stone: lambert({ color: "#b7b1a6" }),
    metal: lambert({ color: "#4e555c" }),
    coal: lambert({ color: "#2a2c30" }),
    leaf: lambert({ color: "#3f6b34" }),
    leafDark: lambert({ color: "#2f5228" }),
    trunk: lambert({ color: "#6b4a32" }),
    horse: lambert({ color: "#6a4630" }),
    horseDark: lambert({ color: "#3e2a1c" }),
    lamp: lambert({ color: "#f6e2a8", emissive: "#e7b15a", emissiveIntensity: 0.6 }),
    whitewash: lambert({ color: "#f7f4ee" }),
  };
}

export function makeSignTexture(title, subtitle, style = "board") {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = subtitle ? 180 : 128;
  const g = c.getContext("2d");
  if (style === "painted") {
    g.fillStyle = "#f4ead4";
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = "#6b5340";
    g.lineWidth = 8;
    g.strokeRect(12, 12, c.width - 24, c.height - 24);
    g.fillStyle = "#24180f";
  } else {
    g.fillStyle = "#3b2718";
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = "#e6d3a8";
    g.lineWidth = 8;
    g.strokeRect(8, 8, c.width - 16, c.height - 16);
    g.fillStyle = "#f6ecd4";
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  const line = (text, y, start) => {
    let size = start;
    do {
      g.font = `600 ${size}px Georgia, "Palatino Linotype", Palatino, serif`;
      if (g.measureText(text).width <= 460) break;
      size -= 2;
    } while (size > 22);
    g.fillText(text, c.width / 2, y);
  };
  if (subtitle) {
    line(title.toUpperCase(), 68, 54);
    g.fillStyle = "#e4c98a";
    line(subtitle, 128, 28);
  } else {
    line(title.toUpperCase(), c.height / 2, 58);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
