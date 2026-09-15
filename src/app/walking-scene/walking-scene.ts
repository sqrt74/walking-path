import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  signal,
} from '@angular/core';

type Point = Readonly<{ x: number; y: number }>;
type SceneObjectKind = 'rock' | 'flower' | 'tree';

type SceneObject = {
  x: number;
  lane: 'back' | 'front';
  kind: SceneObjectKind;
};

@Component({
  selector: 'app-walking-scene',
  templateUrl: './walking-scene.html',
  styleUrl: './walking-scene.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalkingScene implements AfterViewInit, OnDestroy {
  @ViewChild('sceneCanvas', { static: true })
  private readonly canvasRef!: ElementRef<HTMLCanvasElement>;

  readonly isPlaying = signal(true);
  readonly speed = signal(1);

  private readonly sceneWidth = 960;
  private readonly sceneHeight = 540;
  private readonly cycleDuration = 1.25;
  private readonly worldSpeed = 105;
  private animationFrameId = 0;
  private elapsed = 0;
  private worldDistance = 0;
  private distanceUntilSpawn = 250;
  private sceneObjects: SceneObject[] = [
    { x: 760, lane: 'back', kind: 'tree' },
    { x: 990, lane: 'front', kind: 'flower' },
  ];
  private previousTimestamp = 0;
  private resizeObserver?: ResizeObserver;

  constructor(private readonly zone: NgZone) {}

  ngAfterViewInit(): void {
    if (
      typeof window === 'undefined' ||
      typeof ResizeObserver === 'undefined' ||
      typeof requestAnimationFrame === 'undefined'
    ) {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    this.resizeObserver.observe(this.canvasRef.nativeElement);
    this.resizeCanvas();

    this.zone.runOutsideAngular(() => {
      this.animationFrameId = requestAnimationFrame(this.animate);
    });
  }

  ngOnDestroy(): void {
    if (typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.resizeObserver?.disconnect();
  }

  togglePlayback(): void {
    this.isPlaying.update((value) => !value);
  }

  setSpeed(event: Event): void {
    this.speed.set(Number((event.target as HTMLInputElement).value));
  }

  private readonly animate = (timestamp: number): void => {
    if (this.previousTimestamp === 0) this.previousTimestamp = timestamp;

    const deltaSeconds = Math.min((timestamp - this.previousTimestamp) / 1000, 0.05);
    this.previousTimestamp = timestamp;

    if (this.isPlaying()) {
      const scaledDelta = deltaSeconds * this.speed();
      this.elapsed = (this.elapsed + scaledDelta) % this.cycleDuration;
      this.updateWorld(scaledDelta);
    }

    this.drawScene(this.elapsed / this.cycleDuration);
    this.animationFrameId = requestAnimationFrame(this.animate);
  };

  private resizeCanvas(): void {
    const canvas = this.canvasRef.nativeElement;
    const bounds = canvas.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio));
    canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio));
    this.drawScene(this.elapsed / this.cycleDuration);
  }

  private drawScene(progress: number): void {
    const canvas = this.canvasRef.nativeElement;
    const context = canvas.getContext('2d');
    if (!context) return;

    const scale = Math.min(canvas.width / this.sceneWidth, canvas.height / this.sceneHeight);
    const offsetX = (canvas.width - this.sceneWidth * scale) / 2;
    const offsetY = (canvas.height - this.sceneHeight * scale) / 2;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(scale, 0, 0, scale, offsetX, offsetY);

    this.drawBackPath(context);
    this.drawObjects(context, 'back');
    this.drawWalker(context, progress * Math.PI * 2);
    this.drawObjects(context, 'front');
    this.drawFrontPath(context);
  }

  private drawBackPath(context: CanvasRenderingContext2D): void {
    context.save();
    context.strokeStyle = '#111111';
    context.lineWidth = 3;
    context.lineCap = 'round';
    this.drawLine(context, { x: 40, y: 382 }, { x: 920, y: 371 });
    context.restore();
  }

  private drawFrontPath(context: CanvasRenderingContext2D): void {
    context.save();
    context.strokeStyle = '#111111';
    context.lineWidth = 3;
    context.lineCap = 'round';
    this.drawLine(context, { x: 40, y: 512 }, { x: 920, y: 501 });
    context.restore();
  }

  private drawWalker(context: CanvasRenderingContext2D, phase: number): void {
    const centerX = 480;
    // Skupni razpon vijuganja je približno polovica širine poti.
    const laneOffset = Math.sin(this.worldDistance / 2400) * 32;
    const groundY = this.pathY(centerX) + 65 + laneOffset;
    const bob = 3 * Math.cos(phase * 2);
    const hip: Point = { x: centerX, y: groundY - 116 + bob };
    const shoulder: Point = { x: centerX, y: groundY - 224 + bob };

    context.save();
    context.strokeStyle = '#111111';
    context.fillStyle = '#ffffff';
    context.lineCap = 'round';
    context.lineJoin = 'round';

    this.drawLeg(context, hip, phase + Math.PI, groundY, true);
    this.drawArm(context, shoulder, phase, true);
    context.lineWidth = 8;
    this.drawLine(context, shoulder, hip);
    this.drawLeg(context, hip, phase, groundY, false);
    this.drawArm(context, shoulder, phase + Math.PI, false);
    this.drawHead(context, shoulder, bob);
    context.restore();
  }

  private drawLeg(
    context: CanvasRenderingContext2D,
    hip: Point,
    phase: number,
    groundY: number,
    isBackLeg: boolean,
  ): void {
    const normalizedPhase = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
    const stancePart = 0.62;
    // Razdalja stopala v oporni fazi je enaka poti, ki jo v istem času
    // prepotuje okolica. Zato stopalo glede na kamen ali drevo ne drsi.
    const halfStride = (this.worldSpeed * this.cycleDuration * stancePart) / 2;
    let stride: number;
    let lift = 0;

    if (normalizedPhase < stancePart) {
      // Oporna faza: stopalo je na tleh in glede na telo potuje nazaj.
      const stanceProgress = normalizedPhase / stancePart;
      stride = 1 - stanceProgress * 2;
    } else {
      // Prenosna faza: pokrčena noga se dvigne in zaniha naprej.
      const swingProgress = (normalizedPhase - stancePart) / (1 - stancePart);
      stride = -1 + swingProgress * 2;
      lift = Math.sin(swingProgress * Math.PI) * 30;
    }

    const footX = hip.x + stride * halfStride;
    const footY = groundY - lift;
    const knee: Point = {
      x: hip.x + stride * halfStride * 0.5 + 12 + lift * 0.55,
      y: hip.y + (footY - hip.y) * 0.52 - lift * 0.28,
    };

    context.save();
    context.lineWidth = isBackLeg ? 7 : 8;
    this.drawLine(context, hip, knee);
    this.drawLine(context, knee, { x: footX, y: footY });
    this.drawLine(context, { x: footX, y: footY }, { x: footX + 20, y: footY });
    context.restore();
  }

  private drawArm(
    context: CanvasRenderingContext2D,
    shoulder: Point,
    phase: number,
    isBackArm: boolean,
  ): void {
    const swing = Math.sin(phase);
    const upperArmAngle = swing * 0.48;
    const elbowBend = 0.16 + ((swing + 1) / 2) * 0.34;
    const forearmAngle = upperArmAngle + elbowBend;
    const upperArmLength = 49;
    const forearmLength = 46;
    const elbow: Point = {
      x: shoulder.x + Math.sin(upperArmAngle) * upperArmLength,
      y: shoulder.y + Math.cos(upperArmAngle) * upperArmLength,
    };
    const hand: Point = {
      x: elbow.x + Math.sin(forearmAngle) * forearmLength,
      y: elbow.y + Math.cos(forearmAngle) * forearmLength,
    };

    context.save();
    context.lineWidth = isBackArm ? 6 : 7;
    this.drawLine(context, shoulder, elbow);
    this.drawLine(context, elbow, hand);
    context.restore();
  }

  private drawHead(context: CanvasRenderingContext2D, shoulder: Point, bob: number): void {
    const headX = shoulder.x + 2;
    const headY = shoulder.y - 64 + bob * 0.1;

    context.lineWidth = 7;
    context.beginPath();
    context.ellipse(headX, headY, 55, 49, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.fillStyle = '#111111';
    context.beginPath();
    context.ellipse(headX + 33, headY, 6, 13, 0, 0, Math.PI * 2);
    context.fill();
  }

  private pathY(x: number): number {
    return 382 - ((x - 40) / 880) * 11;
  }

  private updateWorld(deltaSeconds: number): void {
    const distance = this.worldSpeed * deltaSeconds;
    this.worldDistance += distance;
    this.distanceUntilSpawn -= distance;

    for (const sceneObject of this.sceneObjects) {
      sceneObject.x -= distance;
    }
    this.sceneObjects = this.sceneObjects.filter((sceneObject) => sceneObject.x > -100);

    if (this.distanceUntilSpawn <= 0) {
      const kinds: SceneObjectKind[] = ['rock', 'flower', 'tree'];
      this.sceneObjects.push({
        x: 1010,
        lane: Math.random() < 0.5 ? 'back' : 'front',
        kind: kinds[Math.floor(Math.random() * kinds.length)],
      });
      this.distanceUntilSpawn = 260 + Math.random() * 190;
    }
  }

  private drawObjects(context: CanvasRenderingContext2D, lane: 'back' | 'front'): void {
    for (const sceneObject of this.sceneObjects) {
      if (sceneObject.lane === lane) this.drawSceneObject(context, sceneObject);
    }
  }

  private drawSceneObject(context: CanvasRenderingContext2D, sceneObject: SceneObject): void {
    const isFront = sceneObject.lane === 'front';
    const y = this.pathY(sceneObject.x) + (isFront ? 101 : 25);
    const scale = isFront ? 0.9 : 0.65;

    context.save();
    context.translate(sceneObject.x, y);
    context.scale(scale, scale);
    context.strokeStyle = '#111111';
    context.fillStyle = '#ffffff';
    context.lineWidth = 4;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    if (sceneObject.kind === 'rock') this.drawRock(context);
    if (sceneObject.kind === 'flower') this.drawFlower(context);
    if (sceneObject.kind === 'tree') this.drawTree(context);
    context.restore();
  }

  private drawRock(context: CanvasRenderingContext2D): void {
    context.beginPath();
    context.moveTo(-27, 0);
    context.quadraticCurveTo(-22, -25, -4, -28);
    context.quadraticCurveTo(19, -25, 28, 0);
    context.closePath();
    context.fill();
    context.stroke();
  }

  private drawFlower(context: CanvasRenderingContext2D): void {
    this.drawLine(context, { x: 0, y: 0 }, { x: 0, y: -42 });
    this.drawLine(context, { x: 0, y: -20 }, { x: -12, y: -29 });
    context.beginPath();
    context.arc(0, -48, 7, 0, Math.PI * 2);
    context.stroke();
    for (let index = 0; index < 5; index++) {
      const angle = (index / 5) * Math.PI * 2;
      context.beginPath();
      context.arc(Math.cos(angle) * 13, -48 + Math.sin(angle) * 13, 7, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }

  private drawTree(context: CanvasRenderingContext2D): void {
    context.beginPath();
    context.rect(-8, -53, 16, 53);
    context.fill();
    context.stroke();
    context.beginPath();
    context.arc(0, -78, 34, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  private drawLine(context: CanvasRenderingContext2D, from: Point, to: Point): void {
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }
}
