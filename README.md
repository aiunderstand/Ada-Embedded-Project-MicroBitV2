# Ada-Embedded-Project-MicroBitV2
Template for USN BSc intelligent real-time systems course

# Start
* Click on the green "Use This Template" button and choose "create a new repository"
* Choose a suitable name for you own project

# To clone this template
* Clone with submodules use `git clone --recurse-submodules https://github.com/aiunderstand/Ada-Embedded-Project-MicroBitV2.git`

# Task automation in this tempalte
* The template uses DependaBot to sync with dependencies (submodules) such as the Ada Driver Library.
* (2do) The template uses the Ada Github action workflow to check if your code compiles

# Template uses 
* Ada language server for VS Code (https://github.com/AdaCore/ada_language_server/blob/master/README.md#vs-code-extension)

# To manually update the template in case there is an update mid-project
We could automate this with for example Actions-Template-Sync (https://stackoverflow.com/questions/56577184/github-pull-changes-from-a-template-repository) but for now the workaround is below:

* git remote add template [https://github.com/aiunderstand/Ada-Embedded-Project-MicroBitV2]
* git fetch --all
* git merge template/[main] --allow-unrelated-histories


