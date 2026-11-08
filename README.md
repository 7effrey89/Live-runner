# Stride Sky

An original 3D endless runner controlled with your body or keyboard.

## Screenshots

![Ready screen](screenshots/ready.png)

![A run in progress](screenshots/playing.png)

## Run locally

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open the displayed local URL in a browser with WebGL support. To use the camera, allow camera access on localhost or HTTPS. Body tracking downloads a MediaPipe pose model from Google on first use, so it requires an internet connection. Video is processed in the browser and is not uploaded.

## How to play

Enable the camera, stand back with your whole body visible, and stand in the center while tracking calibrates. Recalibrate if you change position. Shift left and right to change lanes, jump over low obstacles, and squat to slide under overhead obstacles. Avoid the tall blocks. Collect stars for 50 points each; distance also earns points, and the course speeds up as you run.

Alternatively, use the arrow keys or WASD to move, jump, and slide (space also jumps). Click Start Run to play and Play Again after a collision. Give yourself enough clear space to move safely.

Use `npm run build` for a production build and `npm run lint` to check the code.
