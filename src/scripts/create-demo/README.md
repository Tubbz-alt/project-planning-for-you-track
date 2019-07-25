## Create Demo

### generate-demo-project.ts

This script generates data for an artificial YouTrack project including activity history. The data will be exported as YouTrack “import files” for use with project [fschopp/issue-tracking](https://github.com/fschopp/issue-tracking).

Use as follows from the root of this project:
```bash
npm run prepare
rootdir=$(pwd)
mkdir -p /tmp/generate-demo
cd /tmp/generate-demo
node ${rootdir}/target/scripts/create-demo/generate-demo-project.js
```

This will create the following 4 files:
- Events.xml
- ImportSettings.xml
- Issues.xml
- List.xml

To import the newly generated project into YouTrack, perform the following steps:
1. In YouTrack, create a new project with short name equal to `demoProject.importSettings.youTrackProjectAbbrev` in the script.
2. In YouTrack:
   1. If necessary, create users with login names corresponding to the values in `enum User` of the script.
   2. If necessary, create custom fields with names corresponding to the values in `enum CustomField` of the script. Ensure these custom fields are attached to the new project created in step 1.
   3. Ensure that the link types in `enum LinkType` exist (unless the standard YouTrack link types have been modified, this should be the case).
3. Follow the build instructions for [fschopp/issue-tracking](https://github.com/fschopp/issue-tracking) and then run:
   ```bash
   export YOUTRACK_ACCESS_TOKEN=${access_token}
   issue-tracking-tool.sh YouTrackImport \
     --url ${base_url} \
     --io /tmp/generate-demo
   ```
   where `${access_token}` is a YouTrack access token and `${base_url}` is the YouTrack base URL (for instance, `http://127.0.0.1:8080`).
4. Shut down the YouTrack process.
5. Since the YouTrack REST API currently does not support importing the [activity history](https://www.jetbrains.com/help/youtrack/standalone/resource-api-activities.html) (see [YouTrack issue JT-44862](https://youtrack.jetbrains.com/issue/JT-44862)), importing requires updating the database directly. **Use at your own risk. Only use a YouTrack test setup for this.** Obviously, writing to the database directly requires YouTrack Standalone, and excludes YouTrack InCloud. Run:
   ```bash
   issue-tracking-tool.sh LowLevelYouTrackImport \
     --db ${youtrack_db} \
     --in /tmp/generate-demo
   ```
   where `${youtrack_db}` contains the path to the YouTrack database (this is a directory with `*.xd` files).

### video-to-gif.sh

This script uses `ffmpeg` to convert a video to a GIF, so that it can be included (for example) in a README.md file.

Use as follows:
```bash
video-to-gif.sh "${input_video}" "${output_gif}"
```
