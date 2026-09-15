import { Component } from '@angular/core';
import { WalkingScene } from './walking-scene/walking-scene';

@Component({
  imports: [WalkingScene],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {}
