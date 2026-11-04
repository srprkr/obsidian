#include "PresetManager.h"
#include "PatternSerialization.h"

using namespace juce;

namespace
{
    constexpr int presetFormatVersion = 1;
    const String extension = ".obsidianpreset";
} // namespace

PresetManager::PresetManager (AudioProcessorValueTreeState& s) : state (s) {}

File PresetManager::getPresetFolder()
{
    return File::getSpecialLocation (File::userDocumentsDirectory)
        .getChildFile ("Obsidian Player")
        .getChildFile ("Presets");
}

File PresetManager::fileFor (const String& id) const
{
    // Ids are file names we generated; reject anything that could escape the folder.
    if (id.isEmpty() || id.containsAnyOf ("/\\:") || id.contains (".."))
        return {};

    return getPresetFolder().getChildFile (id + extension);
}

Array<PresetManager::Preset> PresetManager::list() const
{
    Array<Preset> presets;

    for (const auto& file : getPresetFolder().findChildFiles (File::findFiles, false, "*" + extension))
    {
        const auto json = JSON::parse (file);
        if (! json.isObject())
            continue;

        presets.add ({ file.getFileNameWithoutExtension(),
                       json.getProperty ("name", file.getFileNameWithoutExtension()).toString(),
                       (bool) json.getProperty ("favorite", false) });
    }

    std::sort (presets.begin(), presets.end(),
               [] (const Preset& a, const Preset& b) { return a.name.compareNatural (b.name) < 0; });
    return presets;
}

String PresetManager::save (const String& name, const obsidian::StepPattern& pattern)
{
    const auto trimmed = name.trim();
    if (trimmed.isEmpty())
        return {};

    auto* parameters = new DynamicObject();
    for (auto* parameter : state.processor.getParameters())
        if (auto* withId = dynamic_cast<RangedAudioParameter*> (parameter))
            parameters->setProperty (withId->getParameterID(), withId->convertFrom0to1 (withId->getValue()));

    auto* root = new DynamicObject();
    root->setProperty ("version", presetFormatVersion);
    root->setProperty ("name", trimmed);
    root->setProperty ("favorite", false);
    root->setProperty ("parameters", var (parameters));
    root->setProperty ("pattern", PatternSerialization::toVar (pattern));

    auto folder = getPresetFolder();
    folder.createDirectory();

    const auto file = folder.getChildFile (File::createLegalFileName (trimmed) + extension).getNonexistentSibling (false);
    if (! file.replaceWithText (JSON::toString (var (root))))
        return {};

    currentId = file.getFileNameWithoutExtension();
    return currentId;
}

std::optional<obsidian::StepPattern> PresetManager::load (const String& id)
{
    const auto file = fileFor (id);
    const auto json = file.existsAsFile() ? JSON::parse (file) : var();
    if (! json.isObject())
        return std::nullopt;

    if (auto* parameters = json.getProperty ("parameters", {}).getDynamicObject())
    {
        for (const auto& property : parameters->getProperties())
        {
            if (auto* parameter = state.getParameter (property.name.toString()))
            {
                parameter->beginChangeGesture();
                parameter->setValueNotifyingHost (parameter->convertTo0to1 ((float) (double) property.value));
                parameter->endChangeGesture();
            }
        }
    }

    currentId = id;
    return PatternSerialization::fromVar (json.getProperty ("pattern", {}));
}

bool PresetManager::setFavorite (const String& id, bool favorite)
{
    const auto file = fileFor (id);
    auto json = file.existsAsFile() ? JSON::parse (file) : var();
    if (auto* object = json.getDynamicObject())
    {
        object->setProperty ("favorite", favorite);
        return file.replaceWithText (JSON::toString (json));
    }
    return false;
}

bool PresetManager::remove (const String& id)
{
    const auto file = fileFor (id);
    if (! file.existsAsFile() || ! file.deleteFile())
        return false;

    if (currentId == id)
        currentId = {};
    return true;
}
