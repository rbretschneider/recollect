Personal Memory Journal

Functional Requirements Document --- Summary

1. Product Vision

A mobile-first, privacy-first PWA that transforms an existing
photo/video library into an automatically organized timeline of
Memories.

The application does not primarily manage photos.

It answers:

"What happened?"

rather than simply:

"What photos do I have?"

Photos and videos are automatically indexed from an existing NAS/photo
library. The application identifies groups of media that appear to
represent real-world events, presents them as Memory Suggestions,
and allows the user to turn them into permanent journal entries.

Core Loop

Phone → Existing Photo Sync → NAS / Photo Library → Media Indexing →
Event Detection → Memory Suggestion → User Confirmation → Memory

The user should not have to remember to journal. The system notices that
something happened.

2. Primary Differentiator

Existing products are optimized around:

"Find my photos."

This product is optimized around:

"Remember what happened."

A photo is an asset.

A Memory/Event is the primary object.

Example:

Maine Vacation

July 18--21, 2026 · Bar Harbor, Maine
Ryan · Andrea · Family
214 photos · 13 videos

We rented the house near Bar Harbor again this year. The weather was
surprisingly good...

The application converts an unstructured media collection into a
personal history.

3. Target User

Primary target:

Individuals and families with large existing photo libraries who
already automatically back up their photos but do not actively organize
or journal them.

Particularly:

NAS users

self-hosted users

PhotoPrism users

Immich users

Synology/QNAP users

users with large Google Photos/iCloud exports

families with years of accumulated photos

The product should not require users to abandon their existing photo
storage or backup workflow.

4. Product Philosophy

Automatic First

The system should do the organizational work.

Human Curated

AI suggestions are never treated as absolute truth.

Memory Over Media

Photos support the memory; the memory provides context.

Local-First

Personal photos, faces, locations, and journal entries should remain
under the user's control.

Lightweight

The application must work well on:

NAS hardware

Raspberry Pi-class systems

mini PCs

laptops

inexpensive home servers

It should not require a GPU or server-grade CPU for basic operation.

Mobile-First

The primary user experience should be excellent on a phone.

5. Recommended Technology Stack

Layer                   Technology              Purpose

UI                      Angular 21+         Mobile-first PWA and
responsive application
UI

Language                TypeScript          Strong typing and
shared client models

UI Components           Angular CDK +         Accessibility,
selective Angular       overlays, gestures,
Material              dialogs, responsive
primitives

Styling                 SCSS + CSS            Lightweight responsive
variables             styling and theming

PWA                     Angular Service       Installability,
Worker + Web APIs     caching, offline
behavior

Client Storage          IndexedDB + Dexie   Offline cache, pending
edits, local
application state

API                     ASP.NET Core / .NET   Lightweight backend and
10+                   REST API

ORM/Data Access         EF Core             Database access and
migrations

Database                SQLite              Low-resource embedded
database

Full-Text Search        SQLite FTS5         Fast local text search

Vector Search           sqlite-vec or         Embedded semantic
equivalent            search without
requiring PostgreSQL

Image Processing        libvips             Efficient image
resizing and thumbnail
generation

Video Processing        FFmpeg              Video metadata,
thumbnails, previews,
and processing

Metadata                ExifTool / native     EXIF and media metadata
EXIF libraries        extraction

Filesystem Monitoring   .NET                  Detect new/changed
FileSystemWatcher or    media
equivalent

Background Jobs         .NET                  Asynchronous processing
BackgroundService +     without additional
SQLite-backed queue   infrastructure

Realtime Updates        Server-Sent Events    Processing/indexing
(SSE)                 status updates

API Style               REST initially      Simple, cacheable,
well-supported API

AI                      Optional local/cloud  Event interpretation,
providers             embeddings, face/scene
analysis

Local AI                ONNX Runtime /        Privacy-preserving
llama.cpp / optional    inference
Ollama

Deployment              Docker / Docker       Simple self-hosted
Compose               deployment

Architecture Principle

Do not start with microservices.

The initial backend should be a single lightweight application
containing:

REST API

filesystem watcher

media indexer

metadata processor

thumbnail service

event detector

AI workers

SQLite database

No Kubernetes, Redis, Kafka, RabbitMQ, or other distributed
infrastructure should be required for the initial product.

6. PWA Requirements

The PWA must be designed mobile-first, not desktop-first and then
compressed.

Primary interactions should support:

thumb-friendly navigation

bottom navigation

swipeable photo galleries

touch gestures

fullscreen media

responsive cards

fast route transitions

optimistic UI

skeleton loading

virtualized lists

installability

offline-capable operation

Desktop should be an enhanced layout of the same application rather than
a separate product.

7. Angular Architecture

Use modern Angular patterns:

standalone components

signals

computed state

functional providers

route-level lazy loading

modern control flow

zoneless Angular where appropriate

Angular CDK

selective Angular Material

The application should not depend on Angular Material for every visual
component. Photo-heavy interfaces should use lightweight custom
components where appropriate.

8. PWA / Client Architecture

The browser should be treated as a serious application runtime.

Angular PWA
│
├── Application Shell
├── IndexedDB
├── Service Worker
├── Image Cache
├── API Client
└── Offline Queue

IndexedDB can store:

cached Memory data

recently viewed media

pending edits

offline journal edits

selected UI state

A user should be able to temporarily lose connectivity and still:

browse previously accessed Memories

read journal entries

edit an event

write a journal entry

Pending changes can synchronize when connectivity returns.

9. Server Architecture

The server should remain monolithic and lightweight.

ASP.NET Core
│
├── REST API
├── Filesystem Watcher
├── Media Indexer
├── Metadata Processor
├── Thumbnail Service
├── Event Detector
├── AI Workers
└── SQLite

The server is primarily a local media intelligence engine.

The PWA is the user's interface into that knowledge.

10. Storage Architecture

The application should not copy the user's entire photo library into
an application-specific storage system.

Example:

/NAS/Photos/
/NAS/Videos/
/NAS/...

The application indexes those locations.

It owns:

/app/data/
    memory.db
    thumbnails/
    cache/
    embeddings/

Original media remains under the user's control.

This allows the application to coexist with PhotoPrism, Immich, or other
photo systems that point at the same media library.

11. Core Domain Model

The fundamental entities are:

Journal
 └── Memory/Event
      ├── Media
      ├── People
      ├── Location
      ├── Journal Entry
      ├── Tags
      └── Related Memories

Media

Represents the original digital asset.

Potential metadata:

media ID

original filename

path

MIME type

media type

creation timestamp

modification timestamp

GPS

camera

lens

exposure information

hash

perceptual hash

thumbnail references

video duration

orientation

Live Photo relationships

Person

Represents an individual appearing in media.

Location

Represents geographic information.

Memory/Event

Represents something that happened.

Journal Entry

Human-authored narrative attached to a Memory.

12. Primary Domain Object: Memory

Instead of making Photo the center of the application:

Photo
 └── Event

the model should center on:

Memory
 ├── Media
 ├── People
 ├── Location
 ├── Date/Time
 ├── Journal
 ├── Tags
 └── Related Memories

A Memory is a real-world occurrence rather than a filesystem grouping.

Examples:

Maine Vacation

Emma's Birthday

Dinner with Friends

Backyard Project

Christmas 2025

Home Renovation

Camping Weekend

13. Automatic Event Detection

Automatic event detection is the highest-priority technical feature.

The application watches newly indexed media and asks:

"Did something happen here?"

Event clustering should use increasingly expensive signals.

Tier 1 --- Cheap Metadata

timestamp

GPS

geographic distance

time between photographs

media type

camera/device

filesystem/import batch

Tier 2 --- Relationships

overlapping people

burst sequences

video/photo relationships

perceptual hashes

similar locations

Tier 3 --- Computer Vision

image embeddings

scene similarity

object recognition

face detection

Tier 4 --- AI Interpretation

Optional AI may interpret a cluster:

"These 72 photos appear to document a family trip to Boston."

AI should generate suggestions, never silently change user-authored
information.

14. Memory Inbox

The Memory Inbox is a primary feature.

Newly detected clusters appear as suggestions.

Example:

Suggested Memory

Boston Aquarium

83 photos · 4 videos
July 21 · 10:14--14:37
Ryan · Andrea

These photos appear to represent one event.

Actions:

Create Memory

Merge

Split

Ignore

The goal is to reduce organizing thousands of photographs to
occasionally approving a handful of suggestions.

15. Memory Editing

Every Memory should support:

title

description

journal entry

start/end date

approximate date

location

people

cover image

photos

videos

Live Photos

tags

related Memories

custom metadata

Users must be able to completely override AI decisions.

Required operations:

create

edit

delete

merge

split

add media

remove media

reorder media

change cover image

change date

change location

add/remove people

add tags

link related Memories

16. People

People must be separate from application users.

User
 └── Account accessing application

Person
 └── Individual appearing in media

Facial recognition produces:

Face → Person

rather than assuming every detected face represents a known person.

Support:

face detection

face clustering

face embeddings

known people

unknown face clusters

assigning names

merging identities

ignoring faces

event/person relationships

A Person is not necessarily a user account.

17. Journal Experience

The journal is a chronological presentation of Memories.

2026

August
 ├── Maine Vacation
 ├── Backyard Project
 └── Dinner with Friends

July
 ├── Boston Aquarium
 └── Fourth of July

Each Memory can contain:

narrative

photographs

videos

people

location

dates

related Memories

The journal should feel like a visual history of the family, not a
database.

The word "journal" should not dominate the UX. Concepts such as
Memories, Events, and Timeline are more approachable because
they do not imply that the user has to sit down and write regularly.

18. AI Philosophy

AI should primarily be used for organization, not generation.

Processing hierarchy:

Deterministic
    ↓
EXIF / timestamps / GPS / hashes

Computer Vision
    ↓
Faces / embeddings / visual similarity

AI
    ↓
Event interpretation / titles / summaries

The application must not require an LLM for basic functionality.

Without AI:

timestamp + GPS + metadata → event clustering

With AI:

timestamp + GPS + metadata + visual understanding → better
suggestions

19. Local AI

AI capabilities must be modular.

Potential technologies:

ONNX Runtime

llama.cpp

Ollama

local embedding models

optional cloud AI providers

Local inference should be preferred where practical.

Expensive AI operations must be:

asynchronous

optional

resumable

throttled

cancellable

isolated from core application functionality

A modest NAS should not become unusable because hundreds of photographs
arrived overnight.

20. Performance Requirements

Performance is an explicit architectural requirement.

The application must remain useful on weak hardware.

Prioritize:

lazy loading

thumbnail-first rendering

virtual scrolling

bounded background workers

incremental indexing

no full-library rescans

no unnecessary full-resolution image decoding

aggressive caching

proper database indexes

asynchronous processing

resumable jobs

graceful degradation when AI is unavailable

A NAS or mini PC with limited CPU and RAM should still provide a
responsive experience.

21. Media Processing

Use mature native tools rather than implementing image/video processing
manually.

libvips

For:

resizing

thumbnail generation

image transformations

FFmpeg

For:

video metadata

video thumbnails

previews

transcoding where necessary

ExifTool / Native EXIF Libraries

For:

EXIF

GPS

camera information

dates

metadata extraction

Perceptual Hashing

For:

duplicate detection

near-duplicate detection

burst identification

similar-media grouping

22. Background Processing

Media ingestion must be asynchronous.

Filesystem Watcher
       ↓
Ingestion Queue
       ↓
Media Processor
       ↓
┌───────────────┬───────────────┬───────────────┐
│ Metadata      │ Thumbnails    │ AI Processing │
└───────────────┴───────────────┴───────────────┘
                      ↓
                Event Detection
                      ↓
                Memory Suggestions

Each media item should have explicit processing state.

Example:

Discovered
   ↓
Indexed
   ↓
Metadata Extracted
   ↓
Thumbnail Generated
   ↓
Faces Processed
   ↓
Embeddings Generated
   ↓
Event Analysis Complete

Failures should be recoverable. A failed AI operation must never prevent
a photo from being available.

23. Search

Search should combine:

full text

metadata

dates

locations

people

tags

semantic similarity

Examples:

Maine

Ryan and Andrea

camping

birthdays

Boston in 2025

memories with Grandma

beach

that trip we took last summer

The long-term goal is a searchable personal knowledge graph rather than
a filename search engine.

24. PhotoPrism Compatibility

The initial application should not attempt to replace PhotoPrism.

Both applications can initially point at:

/NAS/Photos

Architecture:

                     NAS
                      │
                /Photos/...
                      │
            ┌─────────┴─────────┐
            ▼                   ▼
       PhotoPrism         Memory Journal
            │                   │
       Photo browsing      Memories
       Photo search        Events
       Media management   Journal

PhotoPrism can remain the photo-management system while the new
application becomes the Event + Memory + Story layer.

Eventually, the product can absorb more photo-management capabilities if
doing so creates a better unified experience.

25. Long-Term One-App Goal

The user should ultimately not have to think about which application
manages their photos.

The desired experience is:

┌─────────────────────────────────┐
│ Photos    Memories    Search    │
└─────────────────────────────────┘

Photos

Browse individual media.

Memories

Understand what happened.

Search

Find anything.

The internal architecture may initially coexist with PhotoPrism, but the
user should eventually experience one coherent product.

26. Offline / Disconnected Operation

Core functionality should continue working without Internet access.

The application should support:

browsing cached Memories

reading journal entries

editing events

writing journal entries

browsing previously accessed media

AI may become unavailable when offline, but core application
functionality must remain operational.

27. Development Phases

Phase 1 --- "Something Happened"

Build:

Angular PWA

ASP.NET Core backend

SQLite

NAS indexing

EXIF extraction

thumbnail generation

chronological media browser

timestamp/GPS clustering

Memory Inbox

create/edit Memory

attach media

journal entry

basic search

This phase validates the central product concept.

Phase 2 --- "Remember It"

Add:

face detection

face clustering

known people

event/person relationships

better location handling

richer Memory timeline

Phase 3 --- "Understand It"

Add:

image embeddings

semantic search

automatic titles

AI event descriptions

related Memories

smarter event grouping

Phase 4 --- "Your Life"

Add:

On This Day

annual summaries

trips

person timelines

place timelines

automatic yearbooks

memory resurfacing

long-term life timeline

28. MVP Definition

The MVP is successful if a user can:

Point the application at an existing NAS photo directory.

Automatically index existing media.

Browse media chronologically.

Automatically identify groups of related photos.

See suggested Memories.

Create a Memory from a suggestion.

Edit the Memory title/date/location.

Add/remove photos and videos.

Write a journal entry.

Browse a chronological Memory timeline.

Search by basic metadata.

Continue ingesting new media automatically.

The critical loop is:

New Photos → Automatic Event Detection → User Confirmation → Memory →
Optional Journal Entry

29. Success Criteria

The most important metric is not the number of photos indexed.

It is:

How much useful organization happens without user effort?

A successful system should be able to turn:

20,000 photos

into something resembling:

600 meaningful Memories

with minimal manual work.

The ideal user behavior is:

Take pictures normally.

Forget about the application.

Occasionally open Memory Inbox.

Confirm a few things.

Occasionally add a sentence.

Years later, browse your life.

30. North Star

The product should ultimately make this possible:

"Show me our life in 2025."

Instead of returning 8,000 photographs, it returns:

2025

January
  New Year's Eve

February
  Ski Weekend

March
  Home Renovation

May
  Mother's Day

June
  Maine Trip

July
  Fourth of July

September
  Camping Weekend

November
  Thanksgiving

December
  Christmas

Each item is a Memory, containing the media, people, places, dates,
and whatever the family actually remembers about it.

The computer handles the tedious part:

finding, grouping, indexing, identifying, and organizing.

The human handles the irreplaceable part:

"This is what that day meant to us."

31. Architectural North Star

                     ┌───────────────┐
                     │    Angular    │
                     │      PWA      │
                     └───────┬───────┘
                             │
                       REST / SSE
                             │
                     ┌───────▼───────┐
                     │ ASP.NET Core  │
                     │   Monolith    │
                     └───────┬───────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
          SQLite         NAS Media       Workers
              │                             │
              │                    ┌────────┼────────┐
              │                    │        │        │
              │                 Metadata  Media     AI
              │                 /EXIF    /Video   /Vision
              │                    │        │        │
              └────────────────────┴────────┴────────┘
                             │
                             ▼
                     Memory Detection
                             │
                             ▼
                       Memory Inbox
                             │
                             ▼
                          Memories
                             │
                    ┌────────┼────────┐
                    ▼        ▼        ▼
                  Media   People   Journal

Core principle

Media is the raw evidence.

Automatic processing creates structure.

Memories create meaning.

The human provides the story.