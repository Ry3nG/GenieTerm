import React from "react";
import { Composition } from "remotion";
import { Film } from "./film/Film";
import { DURATION, FPS, HEIGHT, WIDTH } from "./timeline";

export const Root: React.FC = () => (
    <Composition id="GenieFilm" component={Film} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
);
