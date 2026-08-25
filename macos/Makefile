APP      = FeedReader
BUNDLE   = build/$(APP).app
BIN      = .build/release/FeedReaderApp

.PHONY: run build bundle install test clean icon lint format ci

icon:           ## Regenerate Resources/AppIcon.icns
	swift Scripts/make-icon.swift Resources

lint:           ## swift-format lint (strict), same as CI
	xcrun swift-format lint --strict --recursive Sources Tests Scripts Package.swift

format:         ## Rewrite sources with swift-format
	xcrun swift-format format -i --recursive Sources Tests Scripts Package.swift

ci: lint test   ## Everything CI runs

run:            ## Build (debug) and launch from the terminal
	swift run FeedReaderApp

build:
	swift build -c release

bundle: build   ## Package a minimal .app bundle in ./build
	rm -rf $(BUNDLE)
	mkdir -p $(BUNDLE)/Contents/MacOS
	cp $(BIN) $(BUNDLE)/Contents/MacOS/$(APP)
	cp Info.plist $(BUNDLE)/Contents/Info.plist
	mkdir -p $(BUNDLE)/Contents/Resources
	cp Resources/AppIcon.icns $(BUNDLE)/Contents/Resources/
	codesign --force --sign - $(BUNDLE)
	@echo "→ $(BUNDLE)"

install: bundle ## Copy the bundle to ~/Applications
	mkdir -p ~/Applications
	rm -rf ~/Applications/$(APP).app
	cp -R $(BUNDLE) ~/Applications/
	@echo "→ ~/Applications/$(APP).app  (add it to System Settings › General › Login Items to keep it running)"

test:           ## Needs full Xcode (XCTest/Testing are not in Command Line Tools)
	swift test

clean:
	rm -rf .build build
