"use strict";

/*
    CATHY'S MAHJONG
    Optimised iPad version

    Main performance improvements:
    1. Creates tile elements once per deal.
    2. Does not rebuild all 144 tiles after every tap.
    3. Uses one event handler for the entire board.
    4. Reuses one AudioContext.
    5. Caches the current free-tile state.
    6. Updates only the tiles whose state has changed.
    7. Sound starts off by default for maximum iPad performance.
*/

// ============================================================
// TILE SYMBOLS
// ============================================================

const SYMBOLS = [
    ...[
        "🀇", "🀈", "🀉", "🀊", "🀋",
        "🀌", "🀍", "🀎", "🀏"
    ].map(key => ({
        key,
        colour: "red",
        group: null
    })),

    ...[
        "🀐", "🀑", "🀒", "🀓", "🀔",
        "🀕", "🀖", "🀗", "🀘"
    ].map(key => ({
        key,
        colour: "green",
        group: null
    })),

    ...[
        "🀙", "🀚", "🀛", "🀜", "🀝",
        "🀞", "🀟", "🀠", "🀡"
    ].map(key => ({
        key,
        colour: "blue",
        group: null
    })),

    ...[
        "🀀", "🀁", "🀂", "🀃"
    ].map(key => ({
        key,
        colour: "purple",
        group: null
    })),

    {
        key: "🀄",
        colour: "red",
        group: null
    },

    {
        key: "🀅",
        colour: "green",
        group: null
    },

    {
        key: "🀆",
        colour: "blue",
        group: null
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

// ============================================================
// PAGE ELEMENTS
// ============================================================

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

// ============================================================
// GAME STATE
// ============================================================

let tiles = [];
let solution = [];
let history = [];

let selectedTileId = null;
let originalTileTypes = [];

let freeTileIds = new Set();
let tileElements = new Map();

let boardLocked = false;
let soundEnabled = false;
let audioContext = null;

let resizeTimer = null;
let lastPointerTime = 0;

// ============================================================
// GENERAL UTILITIES
// ============================================================

function shuffle(array) {
    for (
        let index = array.length - 1;
        index > 0;
        index -= 1
    ) {
        const randomIndex = Math.floor(
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

function setStatus(message) {
    statusElement.textContent = message;
}

function updateCounters() {
    const remainingTiles = tiles.reduce(
        (total, tile) => {
            return total + (
                tile.removed ? 0 : 1
            );
        },
        0
    );

    tilesLeftElement.textContent =
        String(remainingTiles);

    movesElement.textContent =
        `Moves: ${history.length}`;
}

// ============================================================
// AUDIO
// ============================================================

function getAudioContext() {
    if (!soundEnabled) {
        return null;
    }

    if (!audioContext) {
        const AudioContextClass =
            window.AudioContext ||
            window.webkitAudioContext;

        if (!AudioContextClass) {
            return null;
        }

        audioContext =
            new AudioContextClass();
    }

    if (
        audioContext.state === "suspended"
    ) {
        audioContext.resume().catch(() => {
            // Sound is optional.
        });
    }

    return audioContext;
}

function playTone(
    frequency = 600,
    duration = 0.09
) {
    if (!soundEnabled) {
        return;
    }

    try {
        const context =
            getAudioContext();

        if (!context) {
            return;
        }

        const oscillator =
            context.createOscillator();

        const gain =
            context.createGain();

        oscillator.type = "sine";
        oscillator.frequency.value =
            frequency;

        gain.gain.setValueAtTime(
            0.045,
            context.currentTime
        );

        gain.gain.exponentialRampToValueAtTime(
            0.001,
            context.currentTime + duration
        );

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.start(
            context.currentTime
        );

        oscillator.stop(
            context.currentTime + duration
        );
    } catch (error) {
        // Continue without sound.
    }
}

// ============================================================
// LAYERED BOARD LAYOUT
// ============================================================

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

    /*
        Bottom layer: 96 tiles
        12 columns × 8 rows
    */

    for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 12; x += 1) {
            addPosition(x, y, 0);
        }
    }

    /*
        Second layer: 32 tiles
        8 columns × 4 rows
    */

    for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 8; x += 1) {
            addPosition(
                x + 2,
                y + 2,
                1
            );
        }
    }

    /*
        Third layer: 12 tiles
        4 columns × 3 rows
    */

    for (let y = 0; y < 3; y += 1) {
        for (let x = 0; x < 4; x += 1) {
            addPosition(
                x + 4,
                y + 2.5,
                2
            );
        }
    }

    /*
        Top layer: 4 tiles
        2 columns × 2 rows
    */

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

// ============================================================
// TILE AVAILABILITY
// ============================================================

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

    let leftBlocked = false;
    let rightBlocked = false;
    let covered = false;

    for (
        let index = 0;
        index < tileState.length;
        index += 1
    ) {
        const otherTile =
            tileState[index];

        if (
            otherTile.removed ||
            otherTile.id === tile.id
        ) {
            continue;
        }

        if (
            otherTile.z > tile.z &&
            tilesOverlap(
                tile,
                otherTile
            )
        ) {
            covered = true;
            break;
        }

        if (
            otherTile.z !== tile.z
        ) {
            continue;
        }

        if (
            Math.abs(
                otherTile.y - tile.y
            ) >= 0.85
        ) {
            continue;
        }

        if (
            Math.abs(
                otherTile.x + 1 -
                tile.x
            ) < 0.12
        ) {
            leftBlocked = true;
        }

        if (
            Math.abs(
                otherTile.x -
                (tile.x + 1)
            ) < 0.12
        ) {
            rightBlocked = true;
        }
    }

    return (
        !covered &&
        (
            !leftBlocked ||
            !rightBlocked
        )
    );
}

function calculateFreeTiles(
    tileState = tiles
) {
    const freeIds = new Set();

    for (const tile of tileState) {
        if (
            isTileFree(
                tile,
                tileState
            )
        ) {
            freeIds.add(tile.id);
        }
    }

    return freeIds;
}

function refreshFreeTileState() {
    freeTileIds =
        calculateFreeTiles(tiles);

    for (const tile of tiles) {
        const element =
            tileElements.get(tile.id);

        if (
            !element ||
            tile.removed
        ) {
            continue;
        }

        const tileIsFree =
            freeTileIds.has(tile.id);

        element.classList.toggle(
            "free",
            tileIsFree
        );

        element.classList.toggle(
            "blocked",
            !tileIsFree
        );

        element.setAttribute(
            "aria-label",
            `${
                tileIsFree
                    ? "Free"
                    : "Blocked"
            } Mahjong tile`
        );
    }
}

// ============================================================
// SOLVABLE DEAL GENERATION
// ============================================================

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
        const freeTiles = [];

        for (const tile of workingTiles) {
            if (
                isTileFree(
                    tile,
                    workingTiles
                )
            ) {
                freeTiles.push(tile);
            }
        }

        if (freeTiles.length < 2) {
            throw new Error(
                "No complete removal route was found."
            );
        }

        /*
            Pair tiles from opposite ends of the
            currently accessible positions.
        */

        const firstTile =
            freeTiles[0];

        const secondTile =
            freeTiles[
                freeTiles.length - 1
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

    /*
        72 matching pairs produce 144 tiles.
    */

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

            for (const tileId of pair) {
                Object.assign(
                    newTiles[tileId],
                    tileType
                );
            }
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

// ============================================================
// BOARD SIZING
// ============================================================

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

    const tileRatio = 1.28;

    const horizontalLayerOffset =
        0.12;

    const verticalLayerOffset =
        0.18;

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

    let minimumX = Infinity;
    let maximumX = -Infinity;
    let minimumY = Infinity;
    let maximumY = -Infinity;

    for (const tile of tiles) {
        const logicalLeft =
            tile.x +
            tile.z *
            horizontalLayerOffset;

        const logicalTop =
            tile.y -
            tile.z *
            verticalLayerOffset;

        minimumX = Math.min(
            minimumX,
            logicalLeft
        );

        maximumX = Math.max(
            maximumX,
            logicalLeft + 1
        );

        minimumY = Math.min(
            minimumY,
            logicalTop
        );

        maximumY = Math.max(
            maximumY,
            logicalTop + 1
        );
    }

    const logicalWidth =
        maximumX - minimumX;

    const logicalHeight =
        maximumY - minimumY;

    const scaleByWidth =
        (
            boardWidth -
            horizontalPadding * 2
        ) / logicalWidth;

    const scaleByHeight =
        (
            boardHeight -
            verticalPadding * 2
        ) / (
            logicalHeight *
            tileRatio
        );

    /*
        Leave room for tile shadows.
    */

    const tileWidth =
        Math.min(
            scaleByWidth,
            scaleByHeight
        ) * 0.92;

    const tileHeight =
        tileWidth * tileRatio;

    const visibleWidth =
        logicalWidth *
        tileWidth;

    const visibleHeight =
        logicalHeight *
        tileHeight;

    const offsetX =
        (
            boardWidth -
            visibleWidth
        ) / 2 -
        minimumX *
        tileWidth;

    const offsetY =
        (
            boardHeight -
            visibleHeight
        ) / 2 -
        minimumY *
        tileHeight;

    return {
        tileWidth,
        tileHeight,
        offsetX,
        offsetY,
        horizontalLayerOffset,
        verticalLayerOffset
    };
}

// ============================================================
// CREATE TILE ELEMENTS ONCE
// ============================================================

function createBoardElements() {
    tileElements.clear();
    board.replaceChildren();

    const fragment =
        document.createDocumentFragment();

    const sortedTiles =
        [...tiles].sort(
            (tileA, tileB) => {
                return (
                    tileA.z - tileB.z ||
                    tileA.y - tileB.y ||
                    tileA.x - tileB.x
                );
            }
        );

    for (const tile of sortedTiles) {
        const element =
            document.createElement(
                "button"
            );

        element.type = "button";

        element.className =
            `tile ${tile.colour}`;

        element.dataset.id =
            String(tile.id);

        element.textContent =
            tile.key;

        element.tabIndex = -1;

        tileElements.set(
            tile.id,
            element
        );

        fragment.appendChild(element);
    }

    board.appendChild(fragment);

    positionBoardElements();
    refreshFreeTileState();
    updateCounters();
}

// ============================================================
// POSITION EXISTING TILE ELEMENTS
// ============================================================

function positionBoardElements() {
    if (!tiles.length) {
        return;
    }

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

    for (const tile of tiles) {
        const element =
            tileElements.get(tile.id);

        if (!element) {
            continue;
        }

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

        element.style.left =
            `${left}px`;

        element.style.top =
            `${top}px`;

        element.style.zIndex =
            String(
                100 +
                tile.z * 100 +
                Math.round(
                    tile.y * 10
                ) +
                Math.round(tile.x)
            );
    }
}

// ============================================================
// SELECTION
// ============================================================

function clearSelection() {
    if (selectedTileId !== null) {
        const oldElement =
            tileElements.get(
                selectedTileId
            );

        if (oldElement) {
            oldElement.classList.remove(
                "selected"
            );
        }
    }

    selectedTileId = null;
}

function selectTile(tileId) {
    if (boardLocked) {
        return;
    }

    const chosenTile =
        tiles[tileId];

    if (
        !chosenTile ||
        chosenTile.removed
    ) {
        return;
    }

    if (
        !freeTileIds.has(tileId)
    ) {
        setStatus(
            "That tile is covered or blocked on both sides."
        );

        playTone(180);
        return;
    }

    const chosenElement =
        tileElements.get(tileId);

    if (selectedTileId === null) {
        selectedTileId = tileId;

        chosenElement.classList.add(
            "selected"
        );

        setStatus(
            "Now choose its matching free tile."
        );

        playTone(430);
        return;
    }

    if (selectedTileId === tileId) {
        clearSelection();

        setStatus(
            "Selection cleared."
        );

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
        const previousElement =
            tileElements.get(
                selectedTileId
            );

        if (previousElement) {
            previousElement.classList.remove(
                "selected"
            );
        }

        selectedTileId = tileId;

        chosenElement.classList.add(
            "selected"
        );

        setStatus(
            "Not a match. The new tile is selected."
        );

        playTone(220);
        return;
    }

    removeMatchingPair(
        firstTile,
        chosenTile
    );
}

// ============================================================
// REMOVE PAIR
// ============================================================

function removeMatchingPair(
    firstTile,
    secondTile
) {
    boardLocked = true;

    const firstElement =
        tileElements.get(firstTile.id);

    const secondElement =
        tileElements.get(secondTile.id);

    firstElement.classList.remove(
        "selected"
    );

    firstElement.classList.add(
        "removing"
    );

    secondElement.classList.add(
        "removing"
    );

    selectedTileId = null;

    playTone(720);

    window.setTimeout(() => {
        firstTile.removed = true;
        secondTile.removed = true;

        history.push([
            firstTile.id,
            secondTile.id
        ]);

        firstElement.hidden = true;
        secondElement.hidden = true;

        firstElement.classList.remove(
            "removing"
        );

        secondElement.classList.remove(
            "removing"
        );

        boardLocked = false;

        refreshFreeTileState();
        updateCounters();

        const remainingTiles =
            tiles.length -
            history.length * 2;

        if (remainingTiles === 0) {
            winText.textContent =
                `You completed Cathy's Mahjong in ${history.length} moves.`;

            winWindow.hidden = false;

            playTone(920);
            return;
        }

        if (
            findLegalMoves().length === 0
        ) {
            setStatus(
                "Dead end. Undo a move or restart this deal."
            );

            return;
        }

        setStatus(
            `Good match. ${remainingTiles} tiles remain.`
        );
    }, 180);
}

// ============================================================
// FIND LEGAL MATCHES
// ============================================================

function findLegalMoves() {
    const availableTiles = [];

    for (const tileId of freeTileIds) {
        const tile = tiles[tileId];

        if (
            tile &&
            !tile.removed
        ) {
            availableTiles.push(tile);
        }
    }

    const moves = [];

    for (
        let firstIndex = 0;
        firstIndex <
        availableTiles.length;
        firstIndex += 1
    ) {
        for (
            let secondIndex =
                firstIndex + 1;
            secondIndex <
            availableTiles.length;
            secondIndex += 1
        ) {
            if (
                tilesMatch(
                    availableTiles[firstIndex],
                    availableTiles[secondIndex]
                )
            ) {
                moves.push([
                    availableTiles[firstIndex],
                    availableTiles[secondIndex]
                ]);
            }
        }
    }

    return moves;
}

// ============================================================
// SAFE HINT
// ============================================================

function showSafeHint() {
    if (boardLocked) {
        return;
    }

    let hintPair = null;

    for (const pairIds of solution) {
        const firstTile =
            tiles[pairIds[0]];

        const secondTile =
            tiles[pairIds[1]];

        if (
            !firstTile.removed &&
            !secondTile.removed &&
            freeTileIds.has(
                firstTile.id
            ) &&
            freeTileIds.has(
                secondTile.id
            ) &&
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
        setStatus(
            "No move is available. Use Undo."
        );

        playTone(180);
        return;
    }

    for (const tile of hintPair) {
        const element =
            tileElements.get(tile.id);

        element.classList.remove(
            "hint"
        );

        void element.offsetWidth;

        element.classList.add(
            "hint"
        );
    }

    setStatus(
        "The highlighted tiles are a safe matching pair."
    );
}

// ============================================================
// UNDO
// ============================================================

function undoLastMove() {
    if (boardLocked) {
        return;
    }

    const previousPair =
        history.pop();

    if (!previousPair) {
        setStatus(
            "There is nothing to undo."
        );

        return;
    }

    clearSelection();

    for (const tileId of previousPair) {
        const tile =
            tiles[tileId];

        const element =
            tileElements.get(tileId);

        tile.removed = false;
        element.hidden = false;
    }

    refreshFreeTileState();
    updateCounters();

    setStatus(
        "The last matching pair has been restored."
    );
}

// ============================================================
// NEW DEAL
// ============================================================

function startNewDeal() {
    if (boardLocked) {
        return;
    }

    boardLocked = true;

    setStatus(
        "Preparing a solvable deal…"
    );

    /*
        Yield to Safari before building the deal,
        allowing the status message to appear.
    */

    window.requestAnimationFrame(() => {
        try {
            tiles = createDeal();

            history = [];
            selectedTileId = null;

            winWindow.hidden = true;

            createBoardElements();

            boardLocked = false;

            setStatus(
                "New solvable deal ready. Choose a bright free tile."
            );
        } catch (error) {
            boardLocked = false;

            console.error(error);

            setStatus(
                "The deal could not be prepared. Press New deal again."
            );
        }
    });
}

// ============================================================
// RESTART SAME DEAL
// ============================================================

function restartSameDeal() {
    if (
        boardLocked ||
        !tiles.length
    ) {
        return;
    }

    clearSelection();

    history = [];

    tiles.forEach(
        (tile, index) => {
            tile.removed = false;

            Object.assign(
                tile,
                originalTileTypes[index]
            );

            const element =
                tileElements.get(tile.id);

            element.hidden = false;

            element.className =
                `tile ${tile.colour}`;

            element.textContent =
                tile.key;
        }
    );

    winWindow.hidden = true;

    refreshFreeTileState();
    updateCounters();

    setStatus(
        "The same deal has restarted."
    );
}

// ============================================================
// BOARD TOUCH HANDLING
// ============================================================

function activateBoardTile(event) {
    const tileElement =
        event.target.closest(".tile");

    if (
        !tileElement ||
        !board.contains(tileElement)
    ) {
        return;
    }

    event.preventDefault();

    const tileId =
        Number(tileElement.dataset.id);

    if (
        Number.isInteger(tileId)
    ) {
        selectTile(tileId);
    }
}

/*
    Modern iPads support pointer events. The touch
    fallback supports older Safari versions.
*/

if (window.PointerEvent) {
    board.addEventListener(
        "pointerup",
        event => {
            lastPointerTime =
                Date.now();

            activateBoardTile(event);
        },
        {
            passive: false
        }
    );
} else {
    board.addEventListener(
        "touchend",
        event => {
            lastPointerTime =
                Date.now();

            activateBoardTile(event);
        },
        {
            passive: false
        }
    );
}

/*
    Mouse and keyboard fallback. Ignore any synthetic
    click immediately following a touch or pointer event.
*/

board.addEventListener(
    "click",
    event => {
        if (
            Date.now() -
            lastPointerTime <
            700
        ) {
            return;
        }

        activateBoardTile(event);
    }
);

board.addEventListener(
    "contextmenu",
    event => {
        if (
            event.target.closest(".tile")
        ) {
            event.preventDefault();
        }
    }
);

// ============================================================
// CONTROL BUTTONS
// ============================================================

newGameButton.addEventListener(
    "click",
    startNewDeal
);

hintButton.addEventListener(
    "click",
    showSafeHint
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

soundButton.textContent =
    "Sound off";

soundButton.setAttribute(
    "aria-pressed",
    "false"
);

soundButton.addEventListener(
    "click",
    async event => {
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

        if (soundEnabled) {
            const context =
                getAudioContext();

            if (
                context &&
                context.state ===
                "suspended"
            ) {
                try {
                    await context.resume();
                } catch (error) {
                    // Continue without sound.
                }
            }

            playTone(520);
        }
    }
);

// ============================================================
// RESIZE AND ORIENTATION
// ============================================================

window.addEventListener(
    "resize",
    () => {
        window.clearTimeout(
            resizeTimer
        );

        resizeTimer =
            window.setTimeout(
                positionBoardElements,
                100
            );
    }
);

window.addEventListener(
    "orientationchange",
    () => {
        window.setTimeout(
            positionBoardElements,
            300
        );
    }
);

// ============================================================
// REMOVE OLD SERVICE WORKER AND CACHES
// ============================================================

async function removeOldGameCache() {
    try {
        if (
            "serviceWorker" in navigator
        ) {
            const registrations =
                await navigator
                    .serviceWorker
                    .getRegistrations();

            for (
                const registration
                of registrations
            ) {
                await registration.unregister();
            }
        }

        if ("caches" in window) {
            const cacheNames =
                await caches.keys();

            for (
                const cacheName
                of cacheNames
            ) {
                if (
                    cacheName
                        .toLowerCase()
                        .includes("mahjong")
                ) {
                    await caches.delete(
                        cacheName
                    );
                }
            }
        }
    } catch (error) {
        console.warn(
            "Old cache cleanup was skipped:",
            error
        );
    }
}

// ============================================================
// START
// ============================================================

removeOldGameCache();
startNewDeal();
