import {FFmpeg} from './vendor/ffmpeg/index.js';
export class VideoEncoder {
  constructor(onProgress) {
    this.ffmpeg = new FFmpeg(); this.stopped=false; this.log=[];
    this.ffmpeg.on('log', ({message})=> { this.log.push(message); if (this.log.length>30) this.log.shift(); });
    this.ffmpeg.on('progress', ({time})=> onProgress?.(time/1_000_000));
  }
  async load() {
    await this.ffmpeg.load({coreURL:chrome.runtime.getURL('vendor/core/ffmpeg-core.js'),
      wasmURL:chrome.runtime.getURL('vendor/core/ffmpeg-core.wasm')});
  }
  async write(name, bytes) { await this.ffmpeg.writeFile(name,bytes); }
  async encode(job) {
    await this.write('slides.ffconcat', new TextEncoder().encode(job.concat));
    await this.write('timeline.filter', new TextEncoder().encode(job.filter));
    const code = await this.ffmpeg.exec(job.args);
    if (code !== 0) throw new Error('Сборка видео завершилась с ошибкой. '+this.log.slice(-5).join(' ').slice(0,600));
    const output = await this.ffmpeg.readFile('video.mp4');
    if (!(output instanceof Uint8Array) || output.length<1000) throw new Error('Не удалось сформировать MP4.');
    return new Blob([output],{type:'video/mp4'});
  }
  stop() { if (!this.stopped) { this.ffmpeg.terminate(); this.stopped=true; } }
}
