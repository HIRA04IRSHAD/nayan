// The hero's hover lens: the pond video drawn through a WebGL 1 ripple shader (spec section 9).
// Falls back to the plain video when WebGL or the shader program is unavailable. Returns a cleanup function.
import { pointer } from "./pointer";

const VERT = `attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAG = `precision mediump float;
varying vec2 vUv;
uniform sampler2D tex;
uniform vec2 mouse;
uniform float time;
uniform float presence;
uniform vec2 scale;
uniform vec2 tilt;
vec4 samp(vec2 uv) { return texture2D(tex, (uv - 0.5) * scale + 0.5 + tilt); }
void main() {
  float dist = distance(vUv, mouse);
  float ripple = sin(dist * 20.0 - time * 5.0) * 0.006;
  float strength = smoothstep(0.2, 0.0, dist) * presence;
  vec2 offset = normalize(vUv - mouse + 1e-5) * ripple * strength;
  float r = samp(vUv + offset + vec2(0.005, 0.0) * strength).r;
  float g = samp(vUv + offset).g;
  float b = samp(vUv + offset - vec2(0.005, 0.0) * strength).b;
  gl_FragColor = vec4(r, g, b, 1.0);
}`;

export function startPondLens(video: HTMLVideoElement, canvas: HTMLCanvasElement | null): () => void {
  const showVideo = () => video.classList.add("show");
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas ? (canvas.getContext("webgl", { alpha: false, antialias: false }) as WebGLRenderingContext | null) : null;
  } catch {
    gl = null;
  }
  if (!gl || !canvas) {
    showVideo();
    return () => {};
  }
  const compile = (type: number, src: string) => {
    const s = gl!.createShader(type)!;
    gl!.shaderSource(s, src);
    gl!.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!;
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    showVideo();
    return () => {};
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "position");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const U = (n: string) => gl!.getUniformLocation(prog, n);
  const uMouse = U("mouse"), uTime = U("time"), uPresence = U("presence"), uScale = U("scale"), uTilt = U("tilt");
  gl.uniform1i(U("tex"), 0);

  let sx = 1, sy = 1;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    gl!.viewport(0, 0, canvas.width, canvas.height);
    const A = canvas.width / canvas.height;
    const V = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1276 / 720;
    if (A > V) { sx = 1; sy = V / A; } else { sx = A / V; sy = 1; }
    sx *= 0.975;
    sy *= 0.975;
    gl!.uniform2f(uScale, sx, sy);
  };
  resize();
  window.addEventListener("resize", resize);

  let ready = false;
  let failed = false;
  const onPlaying = () => {
    ready = true;
    resize();
    canvas.classList.add("on");
  };
  video.addEventListener("playing", onPlaying, { once: true });
  if (!video.paused && video.readyState >= 2) onPlaying(); // already playing before this module loaded
  const onError = () => { failed = true; };
  video.addEventListener("error", onError);

  const t0 = performance.now();
  let last = t0;
  let presence = 0, tx = 0, ty = 0;
  let raf = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    presence += ((pointer.inside ? 1 : 0) - presence) * (1 - Math.exp(-6 * dt));
    const kt = 1 - Math.exp(-dt / 0.1);
    tx += (pointer.tx - tx) * kt;
    ty += (pointer.ty - ty) * kt;
    if (!ready || failed || video.paused || video.readyState < 2) return;
    try {
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGB, gl!.RGB, gl!.UNSIGNED_BYTE, video);
    } catch {
      failed = true; // tainted or broken video: keep the still plate
      canvas.classList.remove("on");
      return;
    }
    gl!.uniform2f(uMouse, pointer.u, pointer.v);
    gl!.uniform1f(uTime, (now - t0) / 1000);
    gl!.uniform1f(uPresence, presence);
    gl!.uniform2f(uTilt, tx * 0.009 * sx, ty * 0.009 * sy);
    gl!.drawArrays(gl!.TRIANGLES, 0, 6);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    video.removeEventListener("playing", onPlaying);
    video.removeEventListener("error", onError);
    gl!.deleteTexture(tex);
    gl!.deleteBuffer(buf);
    gl!.deleteProgram(prog);
    gl!.deleteShader(vs);
    gl!.deleteShader(fs);
    gl!.getExtension("WEBGL_lose_context")?.loseContext();
  };
}
