import React from "react";
import { Composition } from "remotion";
import { FilmV2 } from "./v2/FilmV2";
import { LaptopTest } from "./kit/LaptopTest";
import { StyleFrames } from "./v3/StyleFrames";
import { FilmV3 } from "./v3/FilmV3";
import { Measure } from "./v3/Measure";
import { TOTAL } from "./v3/timeline";
import { DURATION, FPS, HEIGHT, WIDTH } from "./timeline";

export const Root: React.FC = () => (
    <>
        <Composition id="GenieFilmV2" component={FilmV2} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
        <Composition id="GenieFilm" component={FilmV3} durationInFrames={TOTAL} fps={FPS} width={WIDTH} height={HEIGHT} />
        <Composition id="GenieFilmV3" component={FilmV3} durationInFrames={TOTAL} fps={FPS} width={WIDTH} height={HEIGHT} />
        <Composition id="Measure" component={Measure} durationInFrames={1} fps={FPS} width={WIDTH} height={HEIGHT} />
        <Composition id="StyleFrames" component={StyleFrames} durationInFrames={10} fps={FPS} width={WIDTH} height={HEIGHT} />
        <Composition id="LaptopTest" component={LaptopTest} durationInFrames={120} fps={FPS} width={WIDTH} height={HEIGHT} />
    </>
);
