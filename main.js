const fragmentShader = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTexture;
uniform float uDensity;
uniform float uDotSize;
uniform float uDotSpacing;
uniform vec3 uDotColor;
uniform float uGamma;
uniform float uBrightnessMin;
uniform float uBrightnessMax;
uniform float uContrast;
uniform float uThreshold;
uniform vec2 uResolution;
uniform float uGlowRadius;
uniform float uGlowIntensity;
uniform float uColorDodgeBlend;

// 改进发光效果的辅助函数
float createGlow(float dist, float brightness, float radius, float intensity) {
    // 使用更平滑的发光衰减
    float falloff = smoothstep(radius, 0.0, dist);
    
    // 使用指数函数增强发光效果
    float glow = pow(falloff, 2.0) * intensity;
    
    // 使用亮度的平方来增强高亮部分的发光
    float brightnessFactor = pow(brightness, 2.0);
    
    // 组合所有效果
    return glow * brightnessFactor;
}

// 改进的 Color dodge 混合模式
vec3 colorDodge(vec3 base, vec3 blend) {
    vec3 result = base / (1.0 - blend);
    return min(result, vec3(1.0)); // 防止过度曝光
}

float getBrightness(vec3 color) {
    // Basic brightness calculation
    float brightness = dot(color, vec3(0.299, 0.587, 0.114));
    
    // Apply adjustable gamma
    brightness = pow(brightness, uGamma);
    
    // Adjustable S-curve
    brightness = smoothstep(uBrightnessMin, uBrightnessMax, brightness);
    
    return brightness;
}

void main() {
    // Calculate grid using dot spacing
    float gridSize = uDensity / uDotSpacing;
    vec2 cells = floor(vUv * gridSize);
    vec2 center = (cells + 0.5) / gridSize;
    
    // Sample surrounding pixels for detail enhancement
    float offset = 1.0 / gridSize;
    vec4 color = texture2D(uTexture, center);
    vec4 colorLeft = texture2D(uTexture, center - vec2(offset, 0.0));
    vec4 colorRight = texture2D(uTexture, center + vec2(offset, 0.0));
    vec4 colorUp = texture2D(uTexture, center - vec2(0.0, offset));
    vec4 colorDown = texture2D(uTexture, center + vec2(0.0, offset));
    
    // Calculate brightness difference with surrounding pixels
    float brightness = getBrightness(color.rgb);
    float brightnessDiff = abs(brightness - getBrightness(colorLeft.rgb)) +
                          abs(brightness - getBrightness(colorRight.rgb)) +
                          abs(brightness - getBrightness(colorUp.rgb)) +
                          abs(brightness - getBrightness(colorDown.rgb));
    
    // Enhance details
    brightness = mix(brightness, 1.0, brightnessDiff * 0.5);
    
    // Calculate dot position with aspect ratio correction
    vec2 cellUv = fract(vUv * gridSize) - 0.5;
    vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
    cellUv *= aspect;
    float dist = length(cellUv * 2.0);
    
    // Use dot size parameter
    float fixedRadius = (uDotSize / uDotSpacing) * 0.5;
    
    // Use adjustable contrast and threshold
    float threshold = uThreshold;
    float contrast = uContrast;
    
    // Apply contrast and threshold
    brightness = (brightness - threshold) * contrast + threshold;
    brightness = clamp(brightness, 0.0, 1.0);
    
    // Create base dot
    float dot = 1.0 - smoothstep(fixedRadius - 0.01, fixedRadius, dist);
    
    // 创建多层发光效果
    float glowRadius = fixedRadius * uGlowRadius;
    float glowIntensity = uGlowIntensity;
    
    // 内层发光
    float innerGlow = createGlow(dist, brightness, glowRadius * 0.7, glowIntensity);
    // 外层发光
    float outerGlow = createGlow(dist, brightness, glowRadius, glowIntensity * 0.5);
    
    // 组合发光效果
    float glow = innerGlow + outerGlow;
    
    // 使用平滑的混合
    vec3 finalColor = uDotColor;
    float finalOpacity = dot + glow * (1.0 - dot);
    
    // 改进的颜色混合
    vec3 glowColor = uDotColor * (brightness + glow * 0.5);
    float blendFactor = smoothstep(0.0, 1.0, brightness * uColorDodgeBlend);
    finalColor = mix(finalColor, colorDodge(finalColor, glowColor), blendFactor);
    
    // 添加额外的亮度提升
    finalColor *= 1.0 + glow * brightness * 0.5;
    
    // 使用平滑的阈值过渡
    float visibilityFactor = smoothstep(threshold - 0.1, threshold + 0.1, brightness);
    
    // 输出最终颜色
    gl_FragColor = vec4(finalColor, finalOpacity * visibilityFactor);
}`;

const vertexShader = `
attribute vec2 position;
varying vec2 vUv;
void main() {
    // Flip X and Y axis to implement 180 degree rotation
    vUv = vec2(1.0 - (position.x * 0.5 + 0.5), 1.0 - (position.y * 0.5 + 0.5));
    gl_Position = vec4(position, 0.0, 1.0);
}`;

let gl, program, canvas;
let video, videoTexture;

async function init() {
    canvas = document.getElementById('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    gl = canvas.getContext('webgl');
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    
    // Enable blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    
    // Create shader program
    program = createShaderProgram();
    
    // Set vertex data
    const vertices = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    
    const positionLocation = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    
    // Initialize video
    await initVideo();
    setupControls();
    render();
}

function createShaderProgram() {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vertexShader);
    gl.compileShader(vs);
    
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fragmentShader);
    gl.compileShader(fs);
    
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);
    
    return program;
}

async function initVideo() {
    video = document.createElement('video');
    video.autoplay = true;
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                facingMode: "user",
                frameRate: { ideal: 30 }
            } 
        });
        video.srcObject = stream;
        await video.play();
        
        video.addEventListener('loadedmetadata', resizeCanvas);
        
        videoTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, videoTexture);
        // Use NEAREST filtering for sharper dot matrix effect
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } catch (err) {
        console.error('Camera access failed:', err);
    }
}

function setupControls() {
    const densityInput = document.getElementById('density');
    const densityValue = document.getElementById('densityValue');
    const minDensityInput = document.getElementById('minDensity');
    const maxDensityInput = document.getElementById('maxDensity');
    const stepDensityInput = document.getElementById('stepDensity');
    const dotSizeInput = document.getElementById('dotSize');
    const dotSpacingInput = document.getElementById('dotSpacing');
    const colorInput = document.getElementById('dotColor');
    const gammaInput = document.getElementById('gamma');
    const brightnessMinInput = document.getElementById('brightnessMin');
    const brightnessMaxInput = document.getElementById('brightnessMax');
    const contrastInput = document.getElementById('contrast');
    const thresholdInput = document.getElementById('threshold');
    const glowRadiusInput = document.getElementById('glowRadius');
    const glowIntensityInput = document.getElementById('glowIntensity');
    const colorDodgeBlendInput = document.getElementById('colorDodgeBlend');

    // Update density slider range and step value
    function updateDensityRange() {
        const min = parseInt(minDensityInput.value);
        const max = parseInt(maxDensityInput.value);
        const step = parseInt(stepDensityInput.value);
        
        densityInput.min = min;
        densityInput.max = max;
        densityInput.step = step;
        
        // Ensure current value is within the new range
        if (densityInput.value < min) densityInput.value = min;
        if (densityInput.value > max) densityInput.value = max;
        
        updateUniforms();
    }

    // Listen for all input changes
    [minDensityInput, maxDensityInput, stepDensityInput].forEach(input => {
        input.addEventListener('change', updateDensityRange);
    });

    [dotSizeInput, dotSpacingInput].forEach(input => {
        input.addEventListener('change', updateUniforms);
    });

    densityInput.addEventListener('input', (e) => {
        const value = e.target.value;
        const spacing = parseInt(dotSpacingInput.value);
        const gridSize = Math.floor(value / spacing);
        densityValue.textContent = `${gridSize} x ${gridSize} (${value}px)`;
        updateUniforms();
    });

    colorInput.addEventListener('input', updateUniforms);

    // Add new event listeners
    [gammaInput, brightnessMinInput, brightnessMaxInput, 
     contrastInput, thresholdInput].forEach(input => {
        input.addEventListener('change', updateUniforms);
    });

    // 添加新的事件监听器
    [glowRadiusInput, glowIntensityInput, colorDodgeBlendInput].forEach(input => {
        input.addEventListener('change', updateUniforms);
    });

    // Initialize display
    updateDensityRange();
}

function updateUniforms() {
    const density = document.getElementById('density').value;
    const dotSize = document.getElementById('dotSize').value;
    const dotSpacing = document.getElementById('dotSpacing').value;
    const dotColor = document.getElementById('dotColor').value;
    const gamma = parseFloat(document.getElementById('gamma').value);
    const brightnessMin = parseFloat(document.getElementById('brightnessMin').value);
    const brightnessMax = parseFloat(document.getElementById('brightnessMax').value);
    const contrast = parseFloat(document.getElementById('contrast').value);
    const threshold = parseFloat(document.getElementById('threshold').value);
    const glowRadius = parseFloat(document.getElementById('glowRadius').value);
    const glowIntensity = parseFloat(document.getElementById('glowIntensity').value);
    const colorDodgeBlend = parseFloat(document.getElementById('colorDodgeBlend').value);

    gl.uniform1f(gl.getUniformLocation(program, 'uDensity'), density);
    gl.uniform1f(gl.getUniformLocation(program, 'uDotSize'), parseFloat(dotSize));
    gl.uniform1f(gl.getUniformLocation(program, 'uDotSpacing'), parseFloat(dotSpacing));

    // Convert color value
    const r = parseInt(dotColor.substr(1,2), 16) / 255;
    const g = parseInt(dotColor.substr(3,2), 16) / 255;
    const b = parseInt(dotColor.substr(5,2), 16) / 255;
    gl.uniform3f(gl.getUniformLocation(program, 'uDotColor'), r, g, b);

    gl.uniform1f(gl.getUniformLocation(program, 'uGamma'), gamma);
    gl.uniform1f(gl.getUniformLocation(program, 'uBrightnessMin'), brightnessMin);
    gl.uniform1f(gl.getUniformLocation(program, 'uBrightnessMax'), brightnessMax);
    gl.uniform1f(gl.getUniformLocation(program, 'uContrast'), contrast);
    gl.uniform1f(gl.getUniformLocation(program, 'uThreshold'), threshold);
    gl.uniform1f(gl.getUniformLocation(program, 'uGlowRadius'), glowRadius);
    gl.uniform1f(gl.getUniformLocation(program, 'uGlowIntensity'), glowIntensity);
    gl.uniform1f(gl.getUniformLocation(program, 'uColorDodgeBlend'), colorDodgeBlend);

    // Update resolution uniform
    gl.uniform2f(
        gl.getUniformLocation(program, 'uResolution'),
        canvas.width,
        canvas.height
    );
}

function resizeCanvas() {
    const videoAspect = video.videoWidth / video.videoHeight;
    const windowAspect = window.innerWidth / window.innerHeight;
    
    let canvasWidth = window.innerWidth;
    let canvasHeight = window.innerHeight;
    
    if (windowAspect > videoAspect) {
        canvasWidth = canvasHeight * videoAspect;
    } else {
        canvasHeight = canvasWidth / videoAspect;
    }
    
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    
    // Update resolution uniform
    gl.uniform2f(
        gl.getUniformLocation(program, 'uResolution'),
        canvasWidth,
        canvasHeight
    );
}

function render() {
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(render);
}

window.addEventListener('load', init);
window.addEventListener('resize', resizeCanvas); 