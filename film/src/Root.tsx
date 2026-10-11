import React from "react";
import { Composition } from "remotion";
import { FilmV2 } from "./v2/FilmV2";
import { LaptopTest } from "./kit/LaptopTest";
import { StyleFrames } from "./v3/StyleFrames";
import { FilmV3 } from "./v3/FilmV3";
import { Measure } from "./v3/Measure";
import { ShortFilm, shortLength } from "./shorts/ShortFilm";
import { Shorts } from "./shorts/specs";
import { Overview, overviewLayout } from "./shorts/Overview";

import { TOTAL } from "./v3/timeline";
import { DURATION, FPS, HEIGHT, WIDTH } from "./timeline";

// Remotion serializes props, so each short gets its own component instead of a spec prop.
const ShortComponents: Record<string, React.FC> = Object.fromEntries(Shorts.map((s) => [s.id, () => <ShortFilm spec={s} />]));

export const Root: React.FC = () => (
    <>
        <Composition id="GenieFilmV2" component={FilmV2} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
        <Composition id="GenieFilm" component={FilmV3} durationInFrames={TOTAL} fps={FPS} width={WIDTH} height={HEIGHT} />
        <Composition id="GenieFilmV3" component={FilmV3} durationInFrames={TOTAL} fps={FPS} width={WIDTH} height={HEIGHT} />
        {Shorts.map((s) => (
            <Composition key={s.id} id={s.id} component={ShortComponents[s.id]} durationInFrames={shortLength(s)} fps={FPS} width={WIDTH} height={HEIGHT} />
        ))}
        <Composition id="Overview" component={Overview} durationInFrames={overviewLayout().total} fps={FPS} width={WIDTH} height={HEIGHT} />
        <Composition id="Measure" component={Measure} durationInFrames={1} fps={FPS} width={WIDTH} height={HEIGHT} />
        <Composition id="StyleFrames" component={StyleFrames} durationInFrames={10} fps={FPS} width={WIDTH} height={HEIGHT} />
        <Composition id="LaptopTest" component={LaptopTest} durationInFrames={120} fps={FPS} width={WIDTH} height={HEIGHT} />
    </>
);
