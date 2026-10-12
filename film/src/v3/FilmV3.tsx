import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { loadFonts } from "../lib/fonts";
import { FilmGrain } from "../kit/stage";
import { ColdOpen } from "./ColdOpen";
import { Title } from "./Title";
import { Connect } from "./Connect";
import { Card } from "./Card";
import { Durable } from "./Durable";
import { HostPorts } from "./HostPorts";
import { Ai } from "./Ai";
import { Outro } from "./Outro";
import { sceneLength, sceneStart } from "./timeline";

loadFonts();

export const FilmV3: React.FC<{ audio?: string }> = ({ audio = "film_v3.wav" }) => (
    <AbsoluteFill style={{ background: "#000" }}>
        <Sequence from={sceneStart("cold")} durationInFrames={sceneLength("cold")} name="Cold open">
            <ColdOpen />
        </Sequence>
        <Sequence from={sceneStart("title")} durationInFrames={sceneLength("title")} name="Title">
            <Title />
        </Sequence>
        <Sequence from={sceneStart("connect")} durationInFrames={sceneLength("connect")} name="Connect">
            <Connect />
        </Sequence>
        <Sequence from={sceneStart("card1")} durationInFrames={sceneLength("card1")} name="Card: lid">
            <Card text="Close the lid. Keep training." length={sceneLength("card1")} />
        </Sequence>
        <Sequence from={sceneStart("durable")} durationInFrames={sceneLength("durable")} name="Durable">
            <Durable />
        </Sequence>
        <Sequence from={sceneStart("card2")} durationInFrames={sceneLength("card2")} name="Card: machine">
            <Card text="See the whole machine." length={sceneLength("card2")} />
        </Sequence>
        <Sequence from={sceneStart("host")} durationInFrames={sceneLength("host")} name="Host + ports">
            <HostPorts />
        </Sequence>
        <Sequence from={sceneStart("card3")} durationInFrames={sceneLength("card3")} name="Card: AI">
            <Card text="Stuck? Ask the AI you already use." length={sceneLength("card3")} />
        </Sequence>
        <Sequence from={sceneStart("ai")} durationInFrames={sceneLength("ai")} name="Command AI">
            <Ai />
        </Sequence>
        <Sequence from={sceneStart("outro")} durationInFrames={sceneLength("outro")} name="Outro">
            <Outro />
        </Sequence>
        <FilmGrain />
        {audio ? <Audio src={staticFile(audio)} /> : null}
    </AbsoluteFill>
);
