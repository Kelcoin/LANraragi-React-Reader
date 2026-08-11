const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aTexCoord;
out vec2 vTexCoord;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vTexCoord = aTexCoord;
}`;

function resolveHookTexture(name, hook) {
  if (name === 'HOOKED') return hook === 'PREKERNEL' ? 'MAIN' : hook;
  if (name === 'PREKERNEL') return 'MAIN';
  return name;
}

function parseDimension(expression, fallback, hook) {
  if (!expression) return { source: fallback, scale: 1 };
  const source = expression.match(/^([A-Za-z0-9_]+)\.[wh]/)?.[1] ?? fallback;
  const scale = Number(expression.match(/\s([0-9]+(?:\.[0-9]+)?)\s*\*\s*$/)?.[1] ?? 1);
  return { source: resolveHookTexture(source, hook), scale };
}

function normalizeWebgl2Offsets(body) {
  return body
    .replaceAll('vec2(x_off, y_off)', 'vec2(float(x_off), float(y_off))')
    .replaceAll('vec2(i - KERNELHALFSIZE, 0)', 'vec2(float(i - KERNELHALFSIZE), 0.0)')
    .replaceAll('vec2(0, i - KERNELHALFSIZE)', 'vec2(0.0, float(i - KERNELHALFSIZE))');
}

export function parseAnime4kPasses(shaderSources) {
  const passes = [];
  for (const source of shaderSources) {
    let current = null;
    for (const line of String(source).replace(/\r/g, '').split('\n')) {
      if (line.startsWith('//!DESC')) {
        if (current) passes.push(current);
        current = {
          description: line.slice(7).trim(),
          hook: 'MAIN',
          bindings: [],
          save: '',
          widthExpression: '',
          heightExpression: '',
          body: [],
        };
        continue;
      }
      if (!current) continue;
      if (line.startsWith('//!HOOK')) current.hook = line.slice(7).trim();
      else if (line.startsWith('//!BIND')) current.bindings.push(line.slice(7).trim());
      else if (line.startsWith('//!SAVE')) current.save = line.slice(7).trim();
      else if (line.startsWith('//!WIDTH')) current.widthExpression = line.slice(8).trim();
      else if (line.startsWith('//!HEIGHT')) current.heightExpression = line.slice(9).trim();
      else if (!line.startsWith('//!')) current.body.push(line);
    }
    if (current) passes.push(current);
  }
  return passes.map((pass) => {
    const hook = resolveHookTexture(pass.hook, pass.hook);
    const bindings = pass.bindings.map((uniform) => ({
      uniform,
      source: resolveHookTexture(uniform, pass.hook),
    }));
    const fallback = bindings[0]?.source ?? hook;
    return {
      description: pass.description,
      bindings,
      save: resolveHookTexture(pass.save || hook, pass.hook),
      width: parseDimension(pass.widthExpression, fallback, pass.hook),
      height: parseDimension(pass.heightExpression, fallback, pass.hook),
      body: normalizeWebgl2Offsets(pass.body.join('\n')),
    };
  });
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(`Anime4K shader compile failed: ${message}`);
  }
  return shader;
}

export function buildAnime4kFragmentSource(pass) {
  const boundNames = new Set(pass.bindings.map(({ uniform }) => uniform));
  const uniforms = pass.bindings.map(({ uniform, source }) => {
    const aliases = source !== uniform && !boundNames.has(source) ? [uniform, source] : [uniform];
    return `
uniform sampler2D ${uniform}_tex;
uniform vec2 ${uniform}_size;
${aliases.map((name) => `#define ${name}_tex(pos) texture(${uniform}_tex, pos)
#define ${name}_texOff(off) texture(${uniform}_tex, vTexCoord + (off) / ${uniform}_size)
#define ${name}_pos vTexCoord
#define ${name}_pt (1.0 / ${uniform}_size)`).join('\n')}`;
  }).join('\n');
  return `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vTexCoord;
out vec4 fragColor;
${uniforms}
${pass.body}
void main() { fragColor = hook(); }`;
}

function compilePass(gl, pass) {
  const fragmentSource = buildAnime4kFragmentSource(pass);
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Unknown shader link error';
    gl.deleteProgram(program);
    throw new Error(`Anime4K shader link failed (${pass.description}): ${message}`);
  }
  return {
    ...pass,
    program,
    uniforms: pass.bindings.map(({ uniform, source }) => ({
      source,
      sampler: gl.getUniformLocation(program, `${uniform}_tex`),
      size: gl.getUniformLocation(program, `${uniform}_size`),
    })),
  };
}

function createTexture(gl, width, height, pixels = null) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  const filter = pixels ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (pixels) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
  }
  return { texture, width, height };
}

export function createAnime4kProcessor({
  shaderSources,
  canvasFactory = () => new OffscreenCanvas(1, 1),
} = {}) {
  const canvas = canvasFactory();
  const gl = canvas?.getContext?.('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error('Anime4K requires WebGL2');
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('Anime4K requires floating-point WebGL framebuffers');
  }
  const parsedPasses = parseAnime4kPasses(shaderSources ?? []);
  if (parsedPasses.length === 0) throw new Error('Anime4K shader pipeline is empty');
  const passes = parsedPasses.map((pass) => compilePass(gl, pass));
  const framebuffer = gl.createFramebuffer();
  const vertexArray = gl.createVertexArray();
  const vertexBuffer = gl.createBuffer();
  const textures = new Map();
  let disposed = false;

  gl.bindVertexArray(vertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, 1, 0, 1,
    -1, -1, 0, 0,
    1, 1, 1, 1,
    1, -1, 1, 0,
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

  const clearTextures = () => {
    textures.forEach(({ texture }) => gl.deleteTexture(texture));
    textures.clear();
  };

  function process(pixels, width, height) {
    if (disposed) throw new Error('Anime4K processor is disposed');
    if (!(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)
      || pixels.length !== width * height * 4) {
      throw new TypeError('Anime4K requires RGBA pixels');
    }
    clearTextures();
    textures.set('MAIN', createTexture(gl, width, height, pixels));
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.bindVertexArray(vertexArray);

    for (const pass of passes) {
      const widthSource = textures.get(pass.width.source);
      const heightSource = textures.get(pass.height.source);
      if (!widthSource || !heightSource) throw new Error(`Anime4K pass source is missing: ${pass.description}`);
      const outputWidth = Math.round(widthSource.width * pass.width.scale);
      const outputHeight = Math.round(heightSource.height * pass.height.scale);
      const output = createTexture(gl, outputWidth, outputHeight);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output.texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.deleteTexture(output.texture);
        throw new Error(`Anime4K framebuffer is incomplete: ${pass.description}`);
      }
      gl.viewport(0, 0, outputWidth, outputHeight);
      gl.useProgram(pass.program);
      pass.uniforms.forEach((uniform, index) => {
        const input = textures.get(uniform.source);
        if (!input) throw new Error(`Anime4K texture is missing: ${uniform.source}`);
        gl.activeTexture(gl.TEXTURE0 + index);
        gl.bindTexture(gl.TEXTURE_2D, input.texture);
        gl.uniform1i(uniform.sampler, index);
        gl.uniform2f(uniform.size, input.width, input.height);
      });
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const previous = textures.get(pass.save);
      textures.set(pass.save, output);
      if (previous) gl.deleteTexture(previous.texture);
    }

    const output = textures.get('MAIN');
    if (!output) throw new Error('Anime4K pipeline produced no MAIN texture');
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output.texture, 0);
    const floats = new Float32Array(output.width * output.height * 4);
    gl.readPixels(0, 0, output.width, output.height, gl.RGBA, gl.FLOAT, floats);
    const result = new Uint8ClampedArray(floats.length);
    for (let index = 0; index < floats.length; index += 4) {
      result[index] = Math.round(Math.max(0, Math.min(1, floats[index])) * 255);
      result[index + 1] = Math.round(Math.max(0, Math.min(1, floats[index + 1])) * 255);
      result[index + 2] = Math.round(Math.max(0, Math.min(1, floats[index + 2])) * 255);
      const x = (index / 4) % output.width;
      const y = Math.floor(index / 4 / output.width);
      const sourceX = Math.min(width - 1, Math.floor(x * width / output.width));
      const sourceY = Math.min(height - 1, Math.floor(y * height / output.height));
      result[index + 3] = pixels[(sourceY * width + sourceX) * 4 + 3];
    }
    return { pixels: result, width: output.width, height: output.height };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTextures();
    passes.forEach(({ program }) => gl.deleteProgram(program));
    gl.deleteFramebuffer(framebuffer);
    gl.deleteBuffer(vertexBuffer);
    gl.deleteVertexArray(vertexArray);
  }

  return { process, dispose };
}

export async function createProductionAnime4kProcessor() {
  const [clamp, restore, upscale] = await Promise.all([
    import('../assets/anime4k/Anime4K_Clamp_Highlights.glsl?raw'),
    import('../assets/anime4k/Anime4K_Restore_CNN_VL.glsl?raw'),
    import('../assets/anime4k/Anime4K_Upscale_CNN_x2_VL.glsl?raw'),
  ]);
  return createAnime4kProcessor({
    shaderSources: [clamp.default, restore.default, upscale.default],
  });
}
