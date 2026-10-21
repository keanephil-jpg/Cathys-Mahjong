"use strict";

/*
    CATHY'S MAHJONG
    iPad-optimised version

    Improvements:
    - Faster start-up
    - No service-worker registration
    - Direct pointer/touch controls
    - Prevents duplicate touch and click events
    - Automatic board fitting
    - Solvable 144-tile deals
*/

const SYMBOLS = [
    ...[
        "🀇", "🀈", "🀉", "🀊", "🀋",
        "🀌", "🀍", "🀎", "🀏"
    ].map(key => ({
        key,
        colour: "red"
    })),

    ...[
        "🀐", "🀑", "🀒", "🀓", "🀔",
        "🀕", "🀖", "🀗", "🀘"
    ].map(key => ({
        key,
        colour: "green"
    })),

    ...[
        "🀙", "🀚", "🀛", "🀜", "🀝",
        "🀞", "🀟", "🀠", "🀡"
    ].map(key => ({
        key,
        colour: "blue"
    })),

    ...[
        "🀀", "🀁", "🀂", "🀃"
    ].map(key => ({
        key,
        colour: "purple"
    })),

    {
        key: "🀄",
        colour: "red"
    },
    {
        key: "🀅",
        colour: "green"
    },
    {
        key: "🀆",
        colour: "blue"
    },

    {
        key: "🀦",
        colour: "gold",
        group: "season"
    },
    {
        key: "🀧",
        colour: "gold",
        group: "season"
    },
    {
        key: "🀨",
        colour: "gold",
        group: "season"
    },
    {
        key: "🀩",
        colour: "gold",
        group: "season"
    },

    {
        key: "🀢",
        colour: "purple",
        group: "flower"
    },
    {
        key: "🀣",
        colour: "purple",
        group: "flower"
    },
    {
        key: "🀤",
        colour: "purple",
        group: "flower"
    },
    {
        key: "🀥",
        colour: "purple",
        group: "flower"
    }
];

const board = document.querySelector("#board");
const statusElement = document.querySelector("#status");
const tilesLeftElement = document.querySelector("#tilesLeft");
const movesElement = document.querySelector("#moves");

const newGameButton = document.querySelector("#newGame");
const hintButton = document.querySelector("#hint");
const undoButton = document.querySelector("#undo");
const restartButton = document.querySelector("#sameDeal");
const soundButton = document.querySelector("#sound");

const winWindow = document.querySelector("#win");
const winText = document.querySelector("#winText");
const playAgainButton = document.querySelector("#again");

let tiles = [];
let solution = [];
let selectedTileId = null;
let history = [];
let originalTileTypes = [];
let soundEnabled = true;
let boardLocked = false;
let resizeTimer = null;

/*
    Remove any old service worker left behind by
    previous versions of the game.
*/

async function removeOldOfflineCache() {
    try {
        if ("serviceWorker" in navigator) {
            const registrations =
                await navigator.serviceWorker.getRegistrations();

            for (const registration of registrations) {
                await registration.unregister();
            }
        }

        if ("caches" in window) {
            const cacheNames = await caches.keys();

            await Promise.all(
                cacheNames
                    .filter(name =>
                        name.includes("mahjong")
                    )
                    .map(name =>
                        caches.delete(name)
                    )
            );
        }
    } catch (error) {
        console.warn(
            "Old cache could not be removed:",
            error
        );
    }
}

function shuffle(array) {
    for (
        let index = array.length - 1;
        index > 0;
        index -= 1
    ) {
        const randomIndex =
            Math.floor(
                Math.random() * (index + 1)
            );

        [
            array[index],
            array[randomIndex]
        ] = [
            array[randomIndex],
            array[index]
        ];
    }

    return array;
}

function playTone(frequency = 600) {
    if (!soundEnabled) return;

    try {
        const AudioClass =
            window.AudioContext ||
            window.webkitAudioContext;

        const audioContext =
            new AudioClass();

        const oscillator =
            audioContext.createOscillator();

        const volume =
            audioContext.createGain();

        oscillator.connect(volume);
        volume.connect(audioContext.destination);

        oscillator.frequency.value =
            frequency;

        volume.gain.setValueAtTime(
            0.055,
            audioContext.currentTime
        );

        volume.gain.exponentialRampToValueAtTime(
            0.001,
            audioContext.currentTime + 0.14
        );

        oscillator.start();

        oscillator.stop(
            audioContext.currentTime + 0.14
        );
    } catch (error) {
        // Sound is optional.
    }
}

/*
    Create 144 layered tile positions.

    Layer 1: 96 tiles
    Layer 2: 32 tiles
    Layer 3: 12 tiles
    Layer 4: 4 tiles
*/

function createLayout() {
    const positions = [];

    function addPosition(x, y, z) {
        positions.push({
            id: positions.length,
            x,
            y,
            z,
            key: "",
            colour: "",
            group: null,
            removed: false
        });
    }

    for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 12; x += 1) {
            addPosition(x, y, 0);
        }
    }

    for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 8; x += 1) {
            addPosition(
                x + 2,
                y + 2,
                1
            );
        }
    }

    for (let y = 0; y < 3; y += 1) {
        for (let x = 0; x < 4; x += 1) {
            addPosition(
                x + 4,
                y + 2.5,
                2
            );
        }
    }

    for (let y = 0; y < 2; y += 1) {
        for (let x = 0; x < 2; x += 1) {
            addPosition(
                x + 5,
                y + 3,
                3
            );
        }
    }

    return positions;
}

function tilesOverlap(tileA, tileB) {
    return (
        tileA.x < tileB.x + 1 &&
        tileA.x + 1 > tileB.x &&
        tileA.y < tileB.y + 1 &&
        tileA.y + 1 > tileB.y
    );
}

function isTileFree(
    tile,
    tileState = tiles
) {
    if (!tile || tile.removed) {
        return false;
    }

    const covered =
        tileState.some(otherTile => {
            return (
                !otherTile.removed &&
                otherTile.id !== tile.id &&
                otherTile.z > tile.z &&
                tilesOverlap(tile, otherTile)
            );
        });

    if (covered) {
        return false;
    }

    const leftBlocked =
        tileState.some(otherTile => {
            return (
                !otherTile.removed &&
                otherTile.id !== tile.id &&
                otherTile.z === tile.z &&
                Math.abs(
                    otherTile.y - tile.y
                ) < 0.85 &&
                Math.abs(
                    otherTile.x + 1 - tile.x
                ) < 0.12
            );
        });

    const rightBlocked =
        tileState.some(otherTile => {
            return (
                !otherTile.removed &&
                otherTile.id !== tile.id &&
                otherTile.z === tile.z &&
                Math.abs(
                    otherTile.y - tile.y
                ) < 0.85 &&
                Math.abs(
                    otherTile.x -
                    (tile.x + 1)
                ) < 0.12
            );
        });

    return (
        !leftBlocked ||
        !rightBlocked
    );
}

/*
    This creates a full legal removal route quickly.
    It removes the first and last available tile at
    every stage.
*/

function createRemovalOrder(layout) {
    const workingTiles =
        layout.map(tile => ({
            ...tile
        }));

    const order = [];

    while (
        order.length <
        workingTiles.length / 2
    ) {
        const available =
            workingTiles.filter(tile =>
                isTileFree(
                    tile,
                    workingTiles
                )
            );

        if (available.length < 2) {
            throw new Error(
                "The layout has no complete removal route."
            );
        }

        const firstTile = available[0];

        const secondTile =
            available[
                available.length - 1
            ];

        firstTile.removed = true;
        secondTile.removed = true;

        order.push([
            firstTile.id,
            secondTile.id
        ]);
    }

    return order;
}

function createDeal() {
    const newTiles =
        createLayout();

    const removalOrder =
        createRemovalOrder(newTiles);

    const pairTypes = [];

    for (
        let pairNumber = 0;
        pairNumber < 72;
        pairNumber += 1
    ) {
        const source =
            SYMBOLS[
                pairNumber %
                SYMBOLS.length
            ];

        pairTypes.push({
            key: source.key,
            colour: source.colour,
            group: source.group || null
        });
    }

    shuffle(pairTypes);

    removalOrder.forEach(
        (pair, pairIndex) => {
            const tileType =
                pairTypes[pairIndex];

            pair.forEach(tileId => {
                Object.assign(
                    newTiles[tileId],
                    tileType
                );
            });
        }
    );

    solution = removalOrder;

    originalTileTypes =
        newTiles.map(tile => ({
            key: tile.key,
            colour: tile.colour,
            group: tile.group || null
        }));

    return newTiles;
}

function tilesMatch(tileA, tileB) {
    if (
        tileA.key === tileB.key
    ) {
        return true;
    }

    return Boolean(
        tileA.group &&
        tileA.group === tileB.group
    );
}

function calculateBoardMetrics() {
    const rectangle =
        board.getBoundingClientRect();

    const boardWidth =
        Math.max(
            rectangle.width,
            300
        );

    const boardHeight =
        Math.max(
            rectangle.height,
            260
        );

    const horizontalPadding =
        Math.max(
            28,
            boardWidth * 0.065
        );

    const verticalPadding =
        Math.max(
            28,
            boardHeight * 0.085
        );

    const tileRatio = 1.28;
    const horizontalLayerOffset = 0.12;
    const verticalLayerOffset = 0.18;

    let minimumX = Infinity;
    let maximumX = -Infinity;
    let minimumY = Infinity;
    let maximumY = -Infinity;

    tiles.forEach(tile => {
        const left =
            tile.x +
            tile.z *
            horizontalLayerOffset;

        const top =
            tile.y * tileRatio -
            tile.z *
            tileRatio *
            verticalLayerOffset;

        minimumX = Math.min(
            minimumX,
            left
        );

        maximumX = Math.max(
            maximumX,
            left + 1
        );

        minimumY = Math.min(
            minimumY,
            top
        );

        maximumY = Math.max(
            maximumY,
            top + tileRatio
        );
    });

    const layoutWidth =
        maximumX - minimumX;

    const layoutHeight =
        maximumY - minimumY;

    const scaleByWidth =
        (
            boardWidth -
            horizontalPadding * 2
        ) / layoutWidth;

    const scaleByHeight =
        (
            boardHeight -
            verticalPadding * 2
        ) / layoutHeight;

    /*
        Use 92% to preserve room for the 3D shadows.
    */

    const tileWidth =
        Math.min(
            scaleByWidth,
            scaleByHeight
        ) * 0.92;

    const tileHeight =
        tileWidth * tileRatio;

    const visibleWidth =
        layoutWidth * tileWidth;

    const visibleHeight =
        layoutHeight * tileWidth;

    const offsetX =
        (
            boardWidth -
            visibleWidth
        ) / 2 -
        minimumX * tileWidth;

    const offsetY =
        (
            boardHeight -
            visibleHeight
        ) / 2 -
        minimumY * tileWidth;

    return {
        tileWidth,
        tileHeight,
        offsetX,
        offsetY,
        horizontalLayerOffset,
        verticalLayerOffset
    };
}

function addTileTouchHandler(
    element,
    tileId
) {
    let startX = 0;
    let startY = 0;
    let moved = false;

    const activate = event => {
        if (moved) return;

        event.preventDefault();
        event.stopPropagation();

        chooseTile(tileId);
    };

    if (window.PointerEvent) {
        element.addEventListener(
            "pointerdown",
            event => {
                startX = event.clientX;
                startY = event.clientY;
                moved = false;
            },
            {
                passive: true
            }
        );

        element.addEventListener(
            "pointermove",
            event => {
                const distance =
                    Math.abs(
                        event.clientX -
                        startX
                    ) +
                    Math.abs(
                        event.clientY -
                        startY
                    );

                if (distance > 12) {
                    moved = true;
                }
            },
            {
                passive: true
            }
        );

        element.addEventListener(
            "pointerup",
            activate,
            {
                passive: false
            }
        );

        element.addEventListener(
            "pointercancel",
            () => {
                moved = true;
            }
        );
    } else {
        element.addEventListener(
            "touchstart",
            event => {
                const touch =
                    event.changedTouches[0];

                startX = touch.clientX;
                startY = touch.clientY;
                moved = false;
            },
            {
                passive: true
            }
        );

        element.addEventListener(
            "touchmove",
            event => {
                const touch =
                    event.changedTouches[0];

                const distance =
                    Math.abs(
                        touch.clientX -
                        startX
                    ) +
                    Math.abs(
                        touch.clientY -
                        startY
                    );

                if (distance > 12) {
                    moved = true;
                }
            },
            {
                passive: true
            }
        );

        element.addEventListener(
            "touchend",
            activate,
            {
                passive: false
            }
        );
    }
}

function renderBoard() {
    if (!tiles.length) return;

    const metrics =
        calculateBoardMetrics();

    board.style.setProperty(
        "--tw",
        `${metrics.tileWidth}px`
    );

    board.style.setProperty(
        "--th",
        `${metrics.tileHeight}px`
    );

    board.style.setProperty(
        "--fs",
        `${metrics.tileWidth * 0.59}px`
    );

    const fragment =
        document.createDocumentFragment();

    const visibleTiles =
        tiles
            .filter(tile =>
                !tile.removed
            )
            .sort((tileA, tileB) => {
                return (
                    tileA.z - tileB.z ||
                    tileA.y - tileB.y ||
                    tileA.x - tileB.x
                );
            });

    visibleTiles.forEach(tile => {
        const tileElement =
            document.createElement(
                "button"
            );

        const tileIsFree =
            isTileFree(tile);

        tileElement.type = "button";

        tileElement.className = [
            "tile",
            tile.colour,
            tileIsFree
                ? "free"
                : "blocked",
            selectedTileId === tile.id
                ? "selected"
                : ""
        ]
            .filter(Boolean)
            .join(" ");

        tileElement.dataset.id =
            String(tile.id);

        const left =
            metrics.offsetX +
            (
                tile.x +
                tile.z *
                metrics.horizontalLayerOffset
            ) *
            metrics.tileWidth;

        const top =
            metrics.offsetY +
            (
                tile.y -
                tile.z *
                metrics.verticalLayerOffset
            ) *
            metrics.tileHeight;

        tileElement.style.left =
            `${left}px`;

        tileElement.style.top =
            `${top}px`;

        tileElement.style.zIndex =
            String(
                100 +
                tile.z * 100 +
                Math.round(
                    tile.y * 10
                ) +
                Math.round(tile.x)
            );

        tileElement.textContent =
            tile.key;

        tileElement.setAttribute(
            "aria-label",
            `${
                tileIsFree
                    ? "Free"
                    : "Blocked"
            } Mahjong tile`
        );

        addTileTouchHandler(
            tileElement,
            tile.id
        );

        fragment.appendChild(
            tileElement
        );
    });

    board.replaceChildren(fragment);

    const remaining =
        tiles.filter(tile =>
            !tile.removed
        ).length;

    tilesLeftElement.textContent =
        String(remaining);

    movesElement.textContent =
        `Moves: ${history.length}`;
}

function chooseTile(tileId) {
    if (boardLocked) return;

    const chosenTile =
        tiles[tileId];

    if (!isTileFree(chosenTile)) {
        statusElement.textContent =
            "That tile is covered or blocked on both sides.";

        playTone(180);
        return;
    }

    if (selectedTileId === null) {
        selectedTileId = tileId;

        statusElement.textContent =
            "Now choose its matching free tile.";

        playTone(430);
        renderBoard();
        return;
    }

    if (selectedTileId === tileId) {
        selectedTileId = null;

        statusElement.textContent =
            "Selection cleared.";

        renderBoard();
        return;
    }

    const firstTile =
        tiles[selectedTileId];

    if (
        !tilesMatch(
            firstTile,
            chosenTile
        )
    ) {
        selectedTileId = tileId;

        statusElement.textContent =
            "Not a match. The new tile is selected.";

        playTone(220);
        renderBoard();
        return;
    }

    removePair(
        firstTile,
        chosenTile
    );
}

function removePair(
    firstTile,
    secondTile
) {
    boardLocked = true;

    const selector =
        `[data-id="${firstTile.id}"],` +
        `[data-id="${secondTile.id}"]`;

    document
        .querySelectorAll(selector)
        .forEach(element => {
            element.classList.add(
                "removing"
            );
        });

    playTone(720);

    window.setTimeout(() => {
        firstTile.removed = true;
        secondTile.removed = true;

        history.push([
            firstTile.id,
            secondTile.id
        ]);

        selectedTileId = null;
        boardLocked = false;

        renderBoard();

        const remaining =
            tiles.filter(tile =>
                !tile.removed
            ).length;

        if (remaining === 0) {
            winText.textContent =
                `You completed Cathy's Mahjong in ${history.length} moves.`;

            winWindow.hidden = false;
            playTone(920);
            return;
        }

        if (findLegalMoves().length === 0) {
            statusElement.textContent =
                "Dead end. Undo a move or restart this deal.";

            return;
        }

        statusElement.textContent =
            `Good match. ${remaining} tiles remain.`;
    }, 250);
}

function findLegalMoves() {
    const freeTiles =
        tiles.filter(tile =>
            isTileFree(tile)
        );

    const moves = [];

    for (
        let firstIndex = 0;
        firstIndex < freeTiles.length;
        firstIndex += 1
    ) {
        for (
            let secondIndex =
                firstIndex + 1;
            secondIndex <
                freeTiles.length;
            secondIndex += 1
        ) {
            if (
                tilesMatch(
                    freeTiles[firstIndex],
                    freeTiles[secondIndex]
                )
            ) {
                moves.push([
                    freeTiles[firstIndex],
                    freeTiles[secondIndex]
                ]);
            }
        }
    }

    return moves;
}

function showHint() {
    let hintPair = null;

    for (const ids of solution) {
        const firstTile =
            tiles[ids[0]];

        const secondTile =
            tiles[ids[1]];

        if (
            !firstTile.removed &&
            !secondTile.removed &&
            isTileFree(firstTile) &&
            isTileFree(secondTile) &&
            tilesMatch(
                firstTile,
                secondTile
            )
        ) {
            hintPair = [
                firstTile,
                secondTile
            ];

            break;
        }
    }

    if (!hintPair) {
        hintPair =
            findLegalMoves()[0] ||
            null;
    }

    if (!hintPair) {
        statusElement.textContent =
            "No move is available. Use Undo.";

        return;
    }

    const selector =
        `[data-id="${hintPair[0].id}"],` +
        `[data-id="${hintPair[1].id}"]`;

    document
        .querySelectorAll(selector)
        .forEach(element => {
            element.classList.remove(
                "hint"
            );

            void element.offsetWidth;

            element.classList.add(
                "hint"
            );
        });

    statusElement.textContent =
        "The highlighted tiles are a safe matching pair.";
}

function undoLastMove() {
    if (boardLocked) return;

    const previousPair =
        history.pop();

    if (!previousPair) {
        statusElement.textContent =
            "There is nothing to undo.";

        return;
    }

    previousPair.forEach(tileId => {
        tiles[tileId].removed = false;
    });

    selectedTileId = null;

    statusElement.textContent =
        "The last pair has been restored.";

    renderBoard();
}

function startNewDeal() {
    if (boardLocked) return;

    boardLocked = true;

    statusElement.textContent =
        "Preparing a new deal…";

    /*
        Let Safari draw the message first.
    */

    window.requestAnimationFrame(() => {
        try {
            tiles = createDeal();
            history = [];
            selectedTileId = null;
            winWindow.hidden = true;
            boardLocked = false;

            statusElement.textContent =
                "New solvable deal ready. Choose a bright free tile.";

            renderBoard();
        } catch (error) {
            boardLocked = false;

            console.error(error);

            statusElement.textContent =
                "The board could not be prepared. Press New deal again.";
        }
    });
}

function restartSameDeal() {
    if (!tiles.length) return;

    tiles.forEach(
        (tile, index) => {
            tile.removed = false;

            Object.assign(
                tile,
                originalTileTypes[index]
            );
        }
    );

    history = [];
    selectedTileId = null;
    boardLocked = false;
    winWindow.hidden = true;

    statusElement.textContent =
        "The same deal has restarted.";

    renderBoard();
}

newGameButton.addEventListener(
    "click",
    startNewDeal
);

hintButton.addEventListener(
    "click",
    showHint
);

undoButton.addEventListener(
    "click",
    undoLastMove
);

restartButton.addEventListener(
    "click",
    restartSameDeal
);

playAgainButton.addEventListener(
    "click",
    startNewDeal
);

soundButton.addEventListener(
    "click",
    event => {
        soundEnabled =
            !soundEnabled;

        event.currentTarget.textContent =
            soundEnabled
                ? "Sound on"
                : "Sound off";

        event.currentTarget.setAttribute(
            "aria-pressed",
            String(soundEnabled)
        );
    }
);

window.addEventListener(
    "resize",
    () => {
        window.clearTimeout(
            resizeTimer
        );

        resizeTimer =
            window.setTimeout(
                renderBoard,
                100
            );
    }
);

window.addEventListener(
    "orientationchange",
    () => {
        window.setTimeout(
            renderBoard,
            250
        );
    }
);

document.addEventListener(
    "contextmenu",
    event => {
        if (
            event.target.closest(".tile")
        ) {
            event.preventDefault();
        }
    }
);

removeOldOfflineCache();
startNewDeal();
