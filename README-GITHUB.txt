WAHYU STUDIO - BUILD EXE PORTABLE

1. Extract this ZIP.
2. Create a GitHub repository (Public or Private).
3. Upload ALL files and folders from this extracted project to the repository root.
4. Open the repository tab: Actions.
5. Select "Build Wahyu Studio Portable EXE".
6. Click "Run workflow" and confirm.
7. Wait until the workflow is green (completed).
8. Open the completed workflow run, scroll to Artifacts, download
   "Wahyu-Studio-Portable-Windows" and extract the downloaded ZIP.
9. Run Wahyu-Studio-Portable-1.0.0.exe on Windows 10/11 64-bit.

The EXE is built on GitHub's Windows runner. The app itself is designed to
run locally/offline after the EXE has been downloaded. OCR language data and
vendor libraries are bundled in assets/invoice/vendor.

Note: Windows SmartScreen may show an unknown-publisher warning because this
portable build is not code-signed. Choose More info > Run anyway only if you
trust the source you uploaded.
