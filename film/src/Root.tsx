import React from "react";
import { Composition } from "remotion";
import { FilmV2 } from "./v2/FilmV2";
import { DURATION, FPS, HEIGHT, WIDTH } from "./timeline";

export const Root: React.FC = () => (
    <Composition id="GenieFilm" component={FilmV2} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
);
