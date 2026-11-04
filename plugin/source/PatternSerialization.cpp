#include "PatternSerialization.h"

using namespace juce;

namespace
{
    var halfToVar (const obsidian::StepHalf& half)
    {
        auto* object = new DynamicObject();
        object->setProperty ("on", half.on);
        object->setProperty ("velocity", half.velocity);
        object->setProperty ("pitchOffset", half.pitchOffset);
        object->setProperty ("pan", half.pan);
        return var (object);
    }

    obsidian::StepHalf halfFromVar (const var& value)
    {
        obsidian::StepHalf half;
        if (! value.isObject())
            return half;

        half.on = (bool) value.getProperty ("on", false);
        half.velocity = jlimit (0, 127, (int) value.getProperty ("velocity", 100));
        half.pitchOffset = jlimit (-24, 24, (int) value.getProperty ("pitchOffset", 0));
        half.pan = jlimit (-1.0f, 1.0f, (float) (double) value.getProperty ("pan", 0.0));
        return half;
    }
} // namespace

var PatternSerialization::toVar (const obsidian::StepPattern& pattern)
{
    Array<var> steps;
    for (const auto& step : pattern)
    {
        auto* object = new DynamicObject();
        object->setProperty ("split", step.split);
        object->setProperty ("first", halfToVar (step.first));
        object->setProperty ("second", halfToVar (step.second));
        steps.add (var (object));
    }
    return steps;
}

obsidian::StepPattern PatternSerialization::fromVar (const var& value)
{
    obsidian::StepPattern pattern {};
    const auto* steps = value.getArray();
    if (steps == nullptr)
        return pattern;

    for (int i = 0; i < jmin (steps->size(), (int) pattern.size()); ++i)
    {
        const auto& step = steps->getReference (i);
        auto& target = pattern[(size_t) i];
        target.split = (bool) step.getProperty ("split", false);
        target.first = halfFromVar (step.getProperty ("first", {}));
        target.second = halfFromVar (step.getProperty ("second", {}));
    }
    return pattern;
}
