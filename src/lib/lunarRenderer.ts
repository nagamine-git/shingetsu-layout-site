export interface LunarFrame {
  seconds: number;
  cover: number;
  quiet: boolean;
}

const vertexSource = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const fragmentSource = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 resolution;
uniform float seconds;
uniform float cover;
uniform float quiet;
float hash(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 point) {
  vec2 cell = floor(point);
  vec2 fraction = fract(point);
  fraction = fraction * fraction * (3.0 - 2.0 * fraction);
  return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), fraction.x),
    mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), fraction.x), fraction.y);
}
float terrain(vec2 point) {
  float value = 0.0;
  float amplitude = 0.52;
  mat2 rotation = mat2(0.8, -0.6, 0.6, 0.8);
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * noise(point);
    point = rotation * point * 2.06 + 7.3;
    amplitude *= 0.48;
  }
  return value;
}
void main() {
  float pixel = 1.0 / min(resolution.x, resolution.y);
  vec2 point = (gl_FragCoord.xy - resolution * 0.5) / min(resolution.x, resolution.y);
  float distance = length(point);
  float radius = 0.35;
  float motion = min(seconds, 6.4) * (1.0 - quiet);
  vec2 wind = vec2(motion * 0.009, motion * 0.003);
  float depth = terrain(point * vec2(4.0, 5.6) + wind + vec2(12.0, 5.0));
  float mist = terrain(point * 8.0 - wind * 1.4 + depth * 1.6);
  float banks = smoothstep(0.30, 0.72, depth) * (0.35 + mist * 0.65);
  float edge = (1.0 - smoothstep(0.40, 0.50, max(abs(point.x), abs(point.y)))) * (1.0 - smoothstep(0.47, 0.69, distance));
  float aura = exp(-abs(distance - radius) * 11.0);
  float completed = smoothstep(6.4, 8.0, seconds);
  float contact = smoothstep(6.28, 6.42, seconds) * (1.0 - smoothstep(6.72, 7.84, seconds)) * (1.0 - quiet);
  float wisps = terrain(normalize(point + 0.0001) * 3.2 + distance * 19.0);
  vec3 fogColor = vec3(0.45, 0.48, 0.53);
  vec3 lightColor = vec3(0.91, 0.91, 0.87);
  float silver = banks * (0.18 + aura * (0.38 + completed * 0.22));
  vec3 color = fogColor * silver;
  float rimDistance = max(0.0, distance - radius);
  float rim = exp(-rimDistance * 145.0) * 0.35 + exp(-rimDistance * 28.0) * 0.16;
  float rays = exp(-rimDistance * (19.0 + wisps * 16.0)) * wisps * 0.3;
  float bloom = exp(-rimDistance * 9.0) * 0.5;
  float glow = (rim + rays) * 2.2 + bloom;
  color += lightColor * (rim + rays) * (0.16 + completed * 0.84);
  color += lightColor * glow * contact;
  color += lightColor * aura * banks * contact * 0.4;
  float globe = 1.0 - smoothstep(radius - pixel, radius + pixel, distance);
  vec2 sphere = point / radius;
  float elevation = sqrt(max(0.0, 1.0 - dot(sphere, sphere)));
  float mineral = terrain(sphere * 8.0 + vec2(5.1, 2.8));
  float detail = noise(sphere * 84.0);
  float shade = 0.62 + elevation * 0.27 + dot(sphere, vec2(0.13, -0.10));
  vec3 surface = lightColor * shade * (0.64 + mineral * 0.28 + detail * 0.06);
  vec2 center = vec2(-45.0, 31.0) / 600.0 * 0.7 * (1.0 - cover);
  float shadowRadius = radius * mix(0.82, 1.0, cover);
  float shadow = 1.0 - smoothstep(shadowRadius - pixel, shadowRadius + pixel, length(point - center));
  surface *= 1.0 - shadow;
  if (seconds >= 6.4) surface = vec3(0.0);
  color = mix(color, surface, globe);
  float opacity = max(globe, edge * smoothstep(0.005, 0.13, silver + aura * 0.08 + completed * rim + contact * glow));
  gl_FragColor = vec4(color, opacity);
}
`;

export class LunarRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private buffer: WebGLBuffer;
  private uniforms: Record<
    "resolution" | "seconds" | "cover" | "quiet",
    WebGLUniformLocation | null
  >;
  private scale = 1.5;
  private slowFrames = 0;
  private samples = 0;
  private failed = false;
  private validated = false;

  private constructor(
    private canvas: HTMLCanvasElement,
    gl: WebGLRenderingContext,
    program: WebGLProgram,
    buffer: WebGLBuffer,
    private onFailure: () => void,
  ) {
    this.gl = gl;
    this.program = program;
    this.buffer = buffer;
    this.uniforms = {
      resolution: gl.getUniformLocation(program, "resolution"),
      seconds: gl.getUniformLocation(program, "seconds"),
      cover: gl.getUniformLocation(program, "cover"),
      quiet: gl.getUniformLocation(program, "quiet"),
    };
    canvas.addEventListener("webglcontextlost", this.contextLost);
  }

  static create(
    canvas: HTMLCanvasElement,
    onFailure: () => void,
  ): LunarRenderer | undefined {
    let gl: WebGLRenderingContext | null = null;
    const shaders: WebGLShader[] = [];
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    try {
      gl = canvas.getContext("webgl", {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        powerPreference: "low-power",
        preserveDrawingBuffer: true,
      });
      if (!gl) return;
      program = gl.createProgram();
      if (!program) throw new Error("program");
      for (const [type, source] of [
        [gl.VERTEX_SHADER, vertexSource],
        [gl.FRAGMENT_SHADER, fragmentSource],
      ] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error("shader");
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error("link");
      gl.useProgram(program);
      buffer = gl.createBuffer();
      if (!buffer) throw new Error("buffer");
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW,
      );
      const location = gl.getAttribLocation(program, "position");
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
      for (const shader of shaders) gl.deleteShader(shader);
      const renderer = new LunarRenderer(
        canvas,
        gl,
        program,
        buffer,
        onFailure,
      );
      const limit = Math.min(
        gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
        1024,
      );
      canvas.dataset.limit = String(limit);
      renderer.resize();
      if (gl.getError() !== gl.NO_ERROR) {
        renderer.dispose();
        return;
      }
      return renderer;
    } catch {
      if (gl) {
        for (const shader of shaders) gl.deleteShader(shader);
        if (program) gl.deleteProgram(program);
        if (buffer) gl.deleteBuffer(buffer);
      }
      return;
    }
  }

  resize(): void {
    if (this.failed) return;
    const bounds = this.canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, this.scale);
    const cap = Math.min(Number(this.canvas.dataset.limit) || 1024, 1000);
    const width = Math.max(1, Math.min(cap, Math.round(bounds.width * ratio)));
    const height = Math.max(
      1,
      Math.min(cap, Math.round(bounds.height * ratio)),
    );
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
      this.validated = false;
    }
    this.canvas.dataset.quality =
      this.scale > 1 ? "high" : this.scale > 0.65 ? "balanced" : "light";
  }

  sample(interval: number): void {
    if (interval <= 0 || this.scale <= 0.6) return;
    this.samples += 1;
    if (interval > 28) this.slowFrames += 1;
    if (this.samples >= 45) {
      if (this.slowFrames > 16) {
        this.scale = this.scale > 1 ? 1 : 0.6;
        this.resize();
      }
      this.samples = 0;
      this.slowFrames = 0;
    }
  }

  draw(frame: LunarFrame): boolean {
    if (this.failed) return false;
    try {
      const gl = this.gl;
      gl.uniform2f(
        this.uniforms.resolution,
        this.canvas.width,
        this.canvas.height,
      );
      gl.uniform1f(this.uniforms.seconds, frame.seconds);
      gl.uniform1f(this.uniforms.cover, frame.cover);
      gl.uniform1f(this.uniforms.quiet, frame.quiet ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!this.validated) {
        if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) {
          this.contextLost();
          return false;
        }
        this.validated = true;
      }
      return true;
    } catch {
      this.contextLost();
      return false;
    }
  }

  private contextLost = (): void => {
    if (this.failed) return;
    this.failed = true;
    this.onFailure();
  };

  dispose(): void {
    this.failed = true;
    this.canvas.removeEventListener("webglcontextlost", this.contextLost);
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
  }
}
